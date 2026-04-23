import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
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

/**
 * Sentinel prefix on leads.calendar_event_id while a create is in
 * flight. Two users tapping "Add to Calendar" at the same time both
 * see calendar_event_id=null; without this, both call
 * createCalendarEvent and only the last-saved id is remembered,
 * leaking an orphan event on Google's side with no DB pointer.
 *
 * The claim is a conditional update: exactly one writer wins the race
 * by flipping null → "pending:<uuid>" via `.is("calendar_event_id", null)`.
 * The loser sees the claim and bails with 409. The winner calls
 * Google, then swaps the sentinel for the real event id.
 */
const PENDING_PREFIX = "pending:";

function isPendingClaim(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PENDING_PREFIX);
}

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

  // Another tab / user is mid-create. Bail out so we don't double-book.
  // The caller can retry after the other create finishes.
  if (isPendingClaim(lead.calendar_event_id)) {
    return NextResponse.json(
      { error: "A calendar sync is already in progress for this lead. Try again in a moment." },
      { status: 409 }
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

    let event: { id: string; htmlLink?: string };
    let claimToken: string | null = null;

    if (lead.calendar_event_id) {
      // Row already has a real event id — straightforward update.
      event = await updateCalendarEvent(token, lead.calendar_event_id, leadForEvent);
    } else {
      // Claim creation rights atomically. `.is("calendar_event_id", null)`
      // gates the UPDATE on the row still being unclaimed; RETURNING id
      // via `.select` tells us whether we won the race.
      claimToken = `${PENDING_PREFIX}${randomUUID()}`;
      const { data: claimed } = await supabase
        .from("leads")
        .update({ calendar_event_id: claimToken })
        .eq("id", id)
        .eq("workspace_id", auth.workspaceId)
        .is("calendar_event_id", null)
        .select("id")
        .maybeSingle();

      if (!claimed) {
        // Someone else got the claim first. Re-read and either surface
        // their real event id (as if this call were a no-op) or report
        // that they're still mid-create.
        const { data: fresh } = await supabase
          .from("leads")
          .select("calendar_event_id")
          .eq("id", id)
          .eq("workspace_id", auth.workspaceId)
          .single();
        if (fresh?.calendar_event_id && !isPendingClaim(fresh.calendar_event_id)) {
          return NextResponse.json({ eventId: fresh.calendar_event_id, already: true });
        }
        return NextResponse.json(
          { error: "A calendar sync is already in progress for this lead. Try again in a moment." },
          { status: 409 }
        );
      }

      try {
        event = await createCalendarEvent(token, leadForEvent);
      } catch (e) {
        // Release the claim so a retry isn't permanently blocked by a
        // stale sentinel. Scope the release to rows that still hold our
        // own token — no risk of clobbering a concurrent success.
        await supabase
          .from("leads")
          .update({ calendar_event_id: null })
          .eq("id", id)
          .eq("workspace_id", auth.workspaceId)
          .eq("calendar_event_id", claimToken);
        throw e;
      }
    }

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

  // Skip the Google call for pending-claim sentinels — those aren't real
  // event ids and deleteCalendarEvent would 404.
  if (lead.calendar_event_id && !isPendingClaim(lead.calendar_event_id)) {
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
