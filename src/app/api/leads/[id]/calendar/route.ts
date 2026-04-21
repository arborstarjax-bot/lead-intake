import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  canSchedule,
} from "@/lib/google/calendar";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!canSchedule(lead)) {
    return NextResponse.json(
      { error: "Lead needs a scheduled day (YYYY-MM-DD) before calendaring." },
      { status: 400 }
    );
  }

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected", connectUrl: "/api/google/connect" },
      { status: 428 }
    );
  }

  // Normalize scheduled_time so Postgres `time` ("HH:MM:SS") and user-entered
  // "HH:MM" compare equally when deciding if a resync is needed.
  const normalizeTime = (t: string | null): string | null => {
    if (!t) return null;
    const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
    return m ? `${m[1]}:${m[2]}` : t;
  };

  try {
    const desiredDay = lead.scheduled_day;
    const desiredTime = normalizeTime(lead.scheduled_time);
    const syncedDay = lead.calendar_scheduled_day;
    const syncedTime = normalizeTime(lead.calendar_scheduled_time);
    const upToDate =
      lead.calendar_event_id && syncedDay === desiredDay && syncedTime === desiredTime;

    if (upToDate) {
      return NextResponse.json({ eventId: lead.calendar_event_id, already: true });
    }

    // Auto-advance status to Scheduled on a successful sync unless the lead
    // is already past that point (Completed should never be walked back).
    // Compute this before building the event so the event description
    // (which embeds lead.status) reflects the value we'll persist.
    const nextStatus =
      lead.status === "Completed" ? lead.status : "Scheduled";
    const leadForEvent = { ...lead, status: nextStatus };

    const event = lead.calendar_event_id
      ? await updateCalendarEvent(token, lead.calendar_event_id, leadForEvent)
      : await createCalendarEvent(token, leadForEvent);

    await supabase
      .from("leads")
      .update({
        calendar_event_id: event.id,
        calendar_scheduled_day: desiredDay,
        calendar_scheduled_time: desiredTime,
        status: nextStatus,
      })
      .eq("id", id);

    return NextResponse.json({ eventId: event.id, htmlLink: event.htmlLink });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/leads/[id]/calendar
 *
 * Cancel / unbook a scheduled lead from the route page. Removes the Google
 * Calendar event (if any), clears the scheduled_time + calendar sync fields,
 * and rolls the status back to "Called / No Response" so the lead shows up
 * in the Called tab ready to be rescheduled. Leaves `scheduled_day` alone
 * so the customer's stated preference isn't lost; the user can clear it
 * from the card if they want to.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Best-effort delete on Google. A 404/410 (already gone) or a missing
  // token shouldn't block the local unbook — the user still wants the lead
  // off the route map.
  if (lead.calendar_event_id) {
    const token = await getAccessToken();
    if (token) {
      try {
        await deleteCalendarEvent(token, lead.calendar_event_id);
      } catch {
        // swallow — local unbook proceeds regardless.
      }
    }
  }

  const nextStatus =
    lead.status === "Completed" || lead.status === "Lost"
      ? lead.status
      : "Called / No Response";

  const { data: updated, error } = await supabase
    .from("leads")
    .update({
      scheduled_time: null,
      calendar_event_id: null,
      calendar_scheduled_day: null,
      calendar_scheduled_time: null,
      status: nextStatus,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: updated });
}
