import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getAccessToken } from "@/modules/calendar/server";
import {
  CALENDAR_PENDING_PREFIX,
  canSchedule,
  createCalendarEvent,
  deleteCalendarEvent,
  isPendingCalendarClaim,
  updateCalendarEvent,
} from "@/modules/calendar/server";
import { requireMembership } from "@/modules/auth/server";

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

  // Another tab / user is mid-create. Bail out so we don't double-book.
  // The caller can retry after the other create finishes.
  if (isPendingCalendarClaim(lead.calendar_event_id)) {
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
      claimToken = `${CALENDAR_PENDING_PREFIX}${randomUUID()}`;
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
        if (fresh?.calendar_event_id && !isPendingCalendarClaim(fresh.calendar_event_id)) {
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

    // When we claimed the create, only write the real event id if the
    // row *still* holds our sentinel. Otherwise a concurrent DELETE (or
    // PATCH cleanup) that ran between createCalendarEvent and this UPDATE
    // would have its null-out silently clobbered, re-resurrecting the
    // event the user just deleted. If the claim lost, roll back Google.
    if (claimToken) {
      const { data: finalRow } = await supabase
        .from("leads")
        .update({
          calendar_event_id: event.id,
          calendar_scheduled_day: desiredDay,
          calendar_scheduled_time: desiredTime,
          status: nextStatus,
        })
        .eq("id", id)
        .eq("workspace_id", auth.workspaceId)
        .eq("calendar_event_id", claimToken)
        .select("id")
        .maybeSingle();

      if (!finalRow) {
        // Claim invalidated mid-flight (e.g. concurrent DELETE). Delete
        // the Google event we just created so we don't leak an orphan.
        try {
          await deleteCalendarEvent(token, event.id);
        } catch {
          // Best-effort cleanup — swallow.
        }
        return NextResponse.json(
          {
            error: "Calendar state changed while syncing — try again.",
            reason: "claim_invalidated",
          },
          { status: 409 }
        );
      }
    } else {
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
    }

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
  if (lead.calendar_event_id && !isPendingCalendarClaim(lead.calendar_event_id)) {
    const token = await getAccessToken(auth.userId);
    if (token) {
      try {
        await deleteCalendarEvent(token, lead.calendar_event_id);
      } catch {
        // swallow — local unbook proceeds regardless.
      }
    }
  }

  // Only demote Scheduled leads to Called / No Response on unbook; other
  // statuses (New, Called / No Response, Completed, Lost) stay as-is.
  // Previously every non-Completed/Lost status was forced to Called / No
  // Response, which wrongly told the user they had called a brand-new
  // lead whose calendar event happened to get cleaned up (e.g. during a
  // concurrent PATCH invalidating a pending claim sentinel).
  const nextStatus =
    lead.status === "Scheduled" ? "Called / No Response" : lead.status;

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
