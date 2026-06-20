import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/modules/auth/server";
import {
  smartBookSlots,
  type SmartBookingMode,
} from "@/modules/schedule/server";
import { MapsUnavailableError, createDriveMemo } from "@/modules/routing/server";
import type { Lead } from "@/modules/leads/model";
import { todayIsoInBusinessTz } from "@/modules/shared/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    leadId: z.string().uuid(),
    mode: z.enum(["balanced", "best_route", "soonest"]).default("balanced"),
    /** Optional YYYY-MM-DD. When omitted, the API searches the lead's
     *  scheduled_day or returns an error if none is set. */
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD")
      .optional(),
  })
  .strict();

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
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "invalid body";
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

  const targetDay = parsed.day ?? lead.scheduled_day;
  if (!targetDay) {
    return NextResponse.json(
      { error: "This lead needs a scheduled day before ranking slots." },
      { status: 400 }
    );
  }

  const todayIso = todayIsoInBusinessTz(settings.timezone);
  if (targetDay < todayIso) {
    return NextResponse.json(
      { error: "That day is in the past — pick a future date." },
      { status: 400 }
    );
  }

  // Calculate working days out from today
  const todayDate = new Date(todayIso + "T12:00:00Z");
  const targetDate = new Date(targetDay + "T12:00:00Z");
  const calendarDaysOut = Math.round(
    (targetDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  // Rough approximation: count working days (skip weekends)
  const workDays = new Set(settings.work_days);
  let workingDaysOut = 0;
  for (let i = 1; i <= calendarDaysOut; i++) {
    const d = new Date(todayDate);
    d.setUTCDate(d.getUTCDate() + i);
    if (workDays.has(d.getUTCDay())) workingDaysOut++;
  }

  // Fetch same-day leads
  const { data: sameDay, error: sameDayErr } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .eq("scheduled_day", targetDay)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed")
    .neq("id", lead.id);
  if (sameDayErr) {
    return NextResponse.json({ error: sameDayErr.message }, { status: 500 });
  }

  const drive = createDriveMemo();

  try {
    const result = await smartBookSlots({
      lead,
      settings,
      others: (sameDay ?? []) as Lead[],
      mode: parsed.mode as SmartBookingMode,
      workingDaysOut,
      day: targetDay,
      drive,
    });

    // Filter past slots for today
    if (targetDay === todayIso) {
      const now = new Date();
      const nowHHMM = now.toLocaleTimeString("en-US", {
        timeZone: settings.timezone,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
      result.allSlots = result.allSlots.filter((s) => s.startTime > nowHHMM);
      result.morningTop3 = result.morningTop3.filter(
        (s) => s.startTime > nowHHMM
      );
      result.afternoonTop3 = result.afternoonTop3.filter(
        (s) => s.startTime > nowHHMM
      );
      if (result.bestOverall && result.bestOverall.startTime <= nowHHMM) {
        result.bestOverall = result.allSlots[0] ?? null;
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json(
        { error: `Google Maps: ${e.message}`, code: e.code },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
