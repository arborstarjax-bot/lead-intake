import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import { createCalendarEvent, canSchedule } from "@/lib/google/calendar";

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

  if (lead.calendar_event_id) {
    return NextResponse.json({ eventId: lead.calendar_event_id, already: true });
  }

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected", connectUrl: "/api/google/connect" },
      { status: 428 }
    );
  }

  try {
    const event = await createCalendarEvent(token, lead);
    await supabase
      .from("leads")
      .update({ calendar_event_id: event.id })
      .eq("id", id);
    return NextResponse.json({ eventId: event.id, htmlLink: event.htmlLink });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
