import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import {
  createCalendarEvent,
  updateCalendarEvent,
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

    const event = lead.calendar_event_id
      ? await updateCalendarEvent(token, lead.calendar_event_id, lead)
      : await createCalendarEvent(token, lead);

    await supabase
      .from("leads")
      .update({
        calendar_event_id: event.id,
        calendar_scheduled_day: desiredDay,
        calendar_scheduled_time: desiredTime,
      })
      .eq("id", id);

    return NextResponse.json({ eventId: event.id, htmlLink: event.htmlLink });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
