import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  canSchedule,
} from "@/lib/google/calendar";
import { requireMembership } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .single();
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!canSchedule(lead)) {
    return NextResponse.json(
      { error: "Lead needs a scheduled day (YYYY-MM-DD) before calendaring." },
      { status: 400 }
    );
  }

  const token = await getAccessToken(auth.userId);
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
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId);

    return NextResponse.json({ eventId: event.id, htmlLink: event.htmlLink });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/leads/[id]/calendar
 *
 * Cancel / unbook a scheduled lead. Removes the Google Calendar event (if
 * any) using the caller's own OAuth token, clears the scheduled_time + sync
 * fields, and rolls the status back to "Called / No Response".
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .single();
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (lead.calendar_event_id) {
    const token = await getAccessToken(auth.userId);
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
    .eq("workspace_id", auth.workspaceId)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: updated });
}
