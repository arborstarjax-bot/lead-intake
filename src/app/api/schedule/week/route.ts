import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { suggestSlots, leadAddressString } from "@/lib/schedule";
import { MapsUnavailableError, createDriveMemo } from "@/lib/maps";
import type { Lead } from "@/lib/types";
import { isoInBusinessTz, dayOfWeekInBusinessTz } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    leadId: z.string().uuid(),
    /** How many days to look ahead from today, inclusive. Default 14. */
    horizonDays: z.number().int().min(1).max(30).default(14),
  })
  .strict();

type DayPreview =
  | {
      date: string;
      isWorkDay: true;
      bestTotalDriveMinutes: number | null;
      slotCount: number;
    }
  | { date: string; isWorkDay: false };

export async function POST(req: Request) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI scheduling needs a Google Maps API key. Add GOOGLE_MAPS_API_KEY on Vercel and redeploy.",
      },
      { status: 503 }
    );
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = createAdminClient();
  const [leadResp, settings] = await Promise.all([
    supabase.from("leads").select("*").eq("id", parsed.leadId).maybeSingle(),
    getSettings(),
  ]);
  if (leadResp.error || !leadResp.data) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const lead = leadResp.data as Lead;

  // Up-front checks — otherwise every day in the picker returns zero slots
  // and the UI shows "No feasible slots" for everything with no explanation
  // of why. Catch the two common causes here and surface them once at the
  // top of the modal.
  if (!homeAddressString(settings)) {
    return NextResponse.json(
      {
        error:
          "Set your starting address in Settings before using the AI scheduler.",
      },
      { status: 400 }
    );
  }
  if (!leadAddressString(lead)) {
    return NextResponse.json(
      {
        error:
          "This lead has no address yet — add one to rank days by drive time.",
      },
      { status: 400 }
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today;
  const end = new Date(today);
  end.setDate(end.getDate() + parsed.horizonDays - 1);

  // Pull every same-horizon job in ONE query so we don't fan out to Supabase
  // per-day.
  const { data: window, error: windowErr } = await supabase
    .from("leads")
    .select("*")
    .gte("scheduled_day", isoInBusinessTz(start))
    .lte("scheduled_day", isoInBusinessTz(end))
    .not("scheduled_time", "is", null)
    .neq("id", lead.id);
  if (windowErr) {
    return NextResponse.json({ error: windowErr.message }, { status: 500 });
  }
  const windowRows = (window ?? []) as Lead[];
  const byDay = new Map<string, Lead[]>();
  for (const row of windowRows) {
    if (!row.scheduled_day) continue;
    const list = byDay.get(row.scheduled_day) ?? [];
    list.push(row);
    byDay.set(row.scheduled_day, list);
  }

  // Single shared memo so duplicate address pairs across days cost one API
  // call total, not one per day.
  const drive = createDriveMemo();
  const workDays = new Set(settings.work_days);

  try {
    const out: DayPreview[] = [];
    const days: Date[] = [];
    for (let i = 0; i < parsed.horizonDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }

    // Run all feasible work days in parallel; the memo in drive() prevents
    // duplicate calls for the same origin-dest pair (e.g. home→new lead).
    const results = await Promise.all(
      days.map(async (d): Promise<DayPreview> => {
        const iso = isoInBusinessTz(d);
        const dow = dayOfWeekInBusinessTz(d); // 0=Sunday .. 6=Saturday
        if (!workDays.has(dow)) {
          return { date: iso, isWorkDay: false };
        }
        const others = byDay.get(iso) ?? [];
        const { slots } = await suggestSlots({
          lead,
          settings,
          others,
          half: "all",
          drive,
        });
        // suggestSlots returns slots in chronological order, so scan for the
        // actual minimum instead of trusting slots[0].
        const best = slots.length
          ? Math.min(...slots.map((s) => s.totalDriveMinutes))
          : null;
        return {
          date: iso,
          isWorkDay: true,
          bestTotalDriveMinutes: best,
          slotCount: slots.length,
        };
      })
    );
    out.push(...results);

    return NextResponse.json({ days: out });
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json(
        { error: `Google Maps: ${e.message}`, code: e.code },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
