import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { requireMembership } from "@/modules/auth";
import { suggestSlots, leadAddressString } from "@/lib/schedule";
import { MapsUnavailableError, createDriveMemo } from "@/lib/maps";
import type { Lead } from "@/lib/types";
import {
  isoInBusinessTz,
  dayOfWeekInBusinessTz,
  upcomingBusinessTzDays,
} from "@/modules/shared/date";

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
      /** Actual minimum drive time among feasible slots, in minutes. */
      bestTotalDriveMinutes: number | null;
      /**
       * Minutes discounted from `bestTotalDriveMinutes` because the day
       * already has a job in the same ZIP / nearby area as the new lead.
       * Purely additive to ranking — the raw drive time shown in the UI is
       * still `bestTotalDriveMinutes`.
       */
      clusterBonusMinutes: number;
      /**
       * What the UI actually ranks on: max(0, best - bonus). A day with
       * strictly more driving but a cluster match can beat a day with
       * slightly less driving and no match.
       */
      effectiveBestMinutes: number | null;
      slotCount: number;
    }
  | { date: string; isWorkDay: false };

/** Zero out any non-digits and grab the 5-digit US zip, if any. */
function normalizeZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const digits = zip.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : null;
}

/**
 * Clustering score: reward days that already have a job geographically
 * near the new lead, because stacking routes in the same area densifies
 * the schedule and saves driving over the full week — even when a given
 * day's standalone best slot is a few minutes cheaper elsewhere.
 *
 * Scoring (minutes, capped at 15):
 *   - Exact same ZIP as the new lead: 5 min each
 *   - Same 3-digit ZIP prefix (same region) but different full ZIP: 2 min each
 *
 * Cap at 15 min so clustering never flips a much-better day — it only
 * tiebreaks reasonable alternatives.
 */
function computeClusterBonus(
  newZip: string | null,
  sameDayLeads: Lead[]
): number {
  if (!newZip) return 0;
  const zip3 = newZip.slice(0, 3);
  let bonus = 0;
  for (const other of sameDayLeads) {
    const otherZip = normalizeZip(other.zip);
    if (!otherZip) continue;
    if (otherZip === newZip) bonus += 5;
    else if (otherZip.slice(0, 3) === zip3) bonus += 2;
  }
  return Math.min(15, bonus);
}

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

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const [leadResp, settings] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .eq("id", parsed.leadId)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle(),
    getSettings(auth.workspaceId),
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

  // Build the day list in business-tz terms. Using `setHours(0,0,0,0)` on a
  // UTC server produces midnight UTC, which is yesterday in ET — that would
  // shift the entire 14-day horizon one day into the past. upcomingBusinessTzDays
  // anchors at noon UTC for each ET calendar day, which survives DST.
  const days = upcomingBusinessTzDays(parsed.horizonDays);
  const startIso = isoInBusinessTz(days[0]);
  const endIso = isoInBusinessTz(days[days.length - 1]);

  // Pull every same-horizon job in ONE query so we don't fan out to Supabase
  // per-day.
  const { data: window, error: windowErr } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .gte("scheduled_day", startIso)
    .lte("scheduled_day", endIso)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed")
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
  const newLeadZip = normalizeZip(lead.zip);

  try {
    const out: DayPreview[] = [];

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
        const clusterBonusMinutes = computeClusterBonus(newLeadZip, others);
        const effectiveBestMinutes =
          best == null ? null : Math.max(0, best - clusterBonusMinutes);
        return {
          date: iso,
          isWorkDay: true,
          bestTotalDriveMinutes: best,
          clusterBonusMinutes,
          effectiveBestMinutes,
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
