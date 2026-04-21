import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getSettings, homeAddressString } from "@/lib/settings";
import { MapsUnavailableError, createDriveMemo } from "@/lib/maps";
import {
  parseHHMM,
  formatHHMM,
  leadAddressString,
} from "@/lib/schedule";
import { getAccessToken } from "@/lib/google/oauth";
import {
  createCalendarEvent,
  updateCalendarEvent,
  canSchedule,
} from "@/lib/google/calendar";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    /** Lead IDs in their new chronological order. */
    orderedLeadIds: z.array(z.string().uuid()).min(1),
    /** When true, also resync every lead whose time shifted to Google Calendar.
     *  Default true so the timeline reorder is one tap. */
    sync: z.boolean().optional().default(true),
  })
  .strict();

type PerLeadResult = {
  leadId: string;
  label: string;
  oldTime: string | null;
  newTime: string;
  calendar: "already" | "created" | "updated" | "skipped" | "error" | "off";
  calendarError?: string;
};

/**
 * POST /api/schedule/reorder
 *
 * Take a manual reorder of a day's stops, compact them back-to-back from
 * work_start using real drive legs, PATCH each lead's scheduled_time, and
 * (by default) resync any lead whose time moved to Google Calendar.
 *
 * Order-of-ops is important:
 *  1. Validate: every id in orderedLeadIds must be a lead scheduled on `date`,
 *     and no scheduled lead on `date` may be missing from the list. This
 *     prevents silent data loss if the UI is stale.
 *  2. Compute new times using Distance Matrix so legs are real-world.
 *  3. Write times to Supabase BEFORE calendar sync — that way a calendar
 *     failure leaves the DB correct and the user can retry sync independently.
 *  4. Sync calendar serially (not parallel) to avoid 429s.
 */
export async function POST(req: Request) {
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

  const supabase = createAdminClient();
  const [settings, rowsResp] = await Promise.all([
    getSettings(),
    supabase
      .from("leads")
      .select("*")
      .eq("scheduled_day", parsed.date)
      .not("scheduled_time", "is", null)
      .neq("status", "Completed"),
  ]);
  if (rowsResp.error) {
    return NextResponse.json({ error: rowsResp.error.message }, { status: 500 });
  }

  const home = homeAddressString(settings);
  if (!home) {
    return NextResponse.json(
      { error: "Set your starting address in Settings before reordering." },
      { status: 400 }
    );
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY is not set." },
      { status: 503 }
    );
  }

  const allLeads = (rowsResp.data ?? []) as Lead[];
  const leadsById = new Map(allLeads.map((l) => [l.id, l]));

  // Validate completeness: the ordered list must exactly cover the day.
  const orderedIds = parsed.orderedLeadIds;
  if (orderedIds.length !== allLeads.length) {
    return NextResponse.json(
      {
        error: `Order is stale: expected ${allLeads.length} stops, got ${orderedIds.length}. Reload and try again.`,
      },
      { status: 409 }
    );
  }
  for (const id of orderedIds) {
    if (!leadsById.has(id)) {
      return NextResponse.json(
        { error: "Order contains a lead not on this day. Reload and try again." },
        { status: 409 }
      );
    }
  }

  // Require every lead to have an address — otherwise we can't compute drive.
  const orderedLeads = orderedIds.map((id) => leadsById.get(id)!);
  for (const l of orderedLeads) {
    if (!leadAddressString(l)) {
      const name =
        l.client?.trim() ||
        `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() ||
        l.id;
      return NextResponse.json(
        { error: `"${name}" has no address — add one before reordering.` },
        { status: 400 }
      );
    }
  }

  const drive = createDriveMemo();
  const workStart = parseHHMM(settings.work_start_time);
  const workEnd = parseHHMM(settings.work_end_time);
  const duration = settings.default_job_minutes;
  const buffer = settings.travel_buffer_minutes;

  // Compact from work_start: home → leg → stop1 → leg → stop2 → …
  // Each stop starts at max(workStart, prev_end + buffer + drive).
  const newTimes: { id: string; newMin: number }[] = [];
  let prevEnd = workStart;
  let prevAddr = home;
  try {
    for (const lead of orderedLeads) {
      const addr = leadAddressString(lead)!;
      const leg = await drive(prevAddr, addr);
      const driveMin = Math.ceil(leg.drive_seconds / 60);
      const startMin = Math.max(workStart, prevEnd + buffer + driveMin);
      newTimes.push({ id: lead.id, newMin: startMin });
      prevEnd = startMin + duration;
      prevAddr = addr;
    }
  } catch (e) {
    if (e instanceof MapsUnavailableError) {
      return NextResponse.json(
        { error: `Google: ${e.message}`, code: e.code },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const lastEnd = newTimes.length > 0 ? newTimes[newTimes.length - 1].newMin + duration : workStart;
  const overflowMinutes = Math.max(0, lastEnd - workEnd);

  // Persist times first. Skip the write if nothing changed for that lead so
  // we don't churn updated_at unnecessarily.
  const shifted: { lead: Lead; newTime: string; oldTime: string | null }[] = [];
  for (const { id, newMin } of newTimes) {
    const lead = leadsById.get(id)!;
    const newTime = formatHHMM(newMin);
    const oldTime = lead.scheduled_time;
    if (oldTime === newTime || oldTime === `${newTime}:00`) continue;
    const { error: upErr } = await supabase
      .from("leads")
      .update({ scheduled_time: newTime })
      .eq("id", id);
    if (upErr) {
      return NextResponse.json(
        { error: `Failed to update time for lead ${id}: ${upErr.message}` },
        { status: 500 }
      );
    }
    shifted.push({ lead: { ...lead, scheduled_time: newTime }, newTime, oldTime });
  }

  // Calendar sync (optional). Runs after DB writes so a Google failure
  // doesn't leave the DB in an inconsistent state.
  const normalizeTime = (t: string | null): string | null => {
    if (!t) return null;
    const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
    return m ? `${m[1]}:${m[2]}` : t;
  };

  const results: PerLeadResult[] = [];
  const token = parsed.sync ? await getAccessToken() : null;
  for (const { id, newMin } of newTimes) {
    const lead = leadsById.get(id)!;
    const newTime = formatHHMM(newMin);
    const oldTime = lead.scheduled_time;
    const label =
      lead.client?.trim() ||
      `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
      "Scheduled job";

    if (!parsed.sync || !token) {
      results.push({
        leadId: id,
        label,
        oldTime,
        newTime,
        calendar: parsed.sync ? "off" : "skipped",
      });
      continue;
    }

    const leadNext: Lead = { ...lead, scheduled_time: newTime };
    if (!canSchedule(leadNext)) {
      results.push({ leadId: id, label, oldTime, newTime, calendar: "skipped" });
      continue;
    }

    const unchanged =
      normalizeTime(oldTime) === newTime &&
      lead.calendar_event_id &&
      lead.calendar_scheduled_day === parsed.date &&
      normalizeTime(lead.calendar_scheduled_time) === newTime;
    if (unchanged) {
      results.push({ leadId: id, label, oldTime, newTime, calendar: "already" });
      continue;
    }

    try {
      const event = lead.calendar_event_id
        ? await updateCalendarEvent(token, lead.calendar_event_id, leadNext)
        : await createCalendarEvent(token, leadNext);
      await supabase
        .from("leads")
        .update({
          calendar_event_id: event.id,
          calendar_scheduled_day: parsed.date,
          calendar_scheduled_time: newTime,
          status: lead.status === "Completed" ? "Completed" : "Scheduled",
        })
        .eq("id", id);
      results.push({
        leadId: id,
        label,
        oldTime,
        newTime,
        calendar: lead.calendar_event_id ? "updated" : "created",
      });
    } catch (e) {
      results.push({
        leadId: id,
        label,
        oldTime,
        newTime,
        calendar: "error",
        calendarError: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    shifted: shifted.length,
    overflowMinutes,
    calendarConnected: Boolean(token),
    results,
  });
}
