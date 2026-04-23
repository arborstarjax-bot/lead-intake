import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { EDITABLE_COLUMNS, LEAD_STATUSES } from "@/lib/types";
import { displayName, normalizeEmail, normalizePhone, normalizeState, normalizeZip } from "@/lib/format";
import { getAccessToken } from "@/lib/google/oauth";
import { deleteCalendarEvent } from "@/lib/google/calendar";
import { requireMembership } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lead: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  // Membership check: the lead must belong to this workspace before any
  // mutation. A missing row is indistinguishable from "belongs to another
  // workspace" from the caller's perspective — surface as 404.
  const { data: existing } = await supabase
    .from("leads")
    .select(
      "id, workspace_id, status, calendar_event_id, first_name, last_name, client, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.workspace_id !== auth.workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  // Optional optimistic-concurrency guard. When the caller sends the
  // `updated_at` they observed on the row, we use it as a WHERE-clause
  // filter on the UPDATE. If the server's `updated_at` has moved
  // since (i.e. someone else wrote to this lead), the UPDATE matches
  // zero rows and we respond 409 so the client can reconcile instead
  // of blindly overwriting the other user's edit. Opt-in because many
  // callers (background jobs, one-shot scripts, the /api/ingest
  // follow-up writes) don't hold a prior snapshot.
  const expectedUpdatedAt =
    typeof body.expected_updated_at === "string"
      ? body.expected_updated_at
      : null;
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_COLUMNS) {
    if (k in body) patch[k] = body[k];
  }
  if (patch.status && !LEAD_STATUSES.includes(patch.status as never)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if ("phone_number" in patch)
    patch.phone_number = normalizePhone(patch.phone_number as string | null) ?? patch.phone_number;
  if ("email" in patch)
    patch.email = normalizeEmail(patch.email as string | null) ?? patch.email;
  if ("state" in patch)
    patch.state = normalizeState(patch.state as string | null) ?? patch.state;
  if ("zip" in patch)
    patch.zip = normalizeZip(patch.zip as string | null) ?? patch.zip;

  if (!("client" in patch) && ("first_name" in patch || "last_name" in patch)) {
    const first = "first_name" in patch ? (patch.first_name as string | null) : existing.first_name;
    const last = "last_name" in patch ? (patch.last_name as string | null) : existing.last_name;
    const derived = displayName(first, last);
    if (!existing.client || existing.client === displayName(existing.first_name, existing.last_name)) {
      patch.client = derived || null;
    }
  }

  // Client Name is now the only name column in the UI. When it changes,
  // split it back into first_name / last_name so calendar event titles and
  // duplicate detection stay in sync with what the user typed.
  if ("client" in patch && !("first_name" in patch) && !("last_name" in patch)) {
    const raw = (patch.client as string | null) ?? "";
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      patch.first_name = null;
      patch.last_name = null;
    } else {
      const idx = trimmed.indexOf(" ");
      if (idx === -1) {
        patch.first_name = trimmed;
        patch.last_name = null;
      } else {
        patch.first_name = trimmed.slice(0, idx);
        patch.last_name = trimmed.slice(idx + 1);
      }
    }
  }

  // Flipping status to Completed should make the job disappear from the
  // route map AND from Google Calendar — a completed job is done and no
  // longer relevant to today's drive plan.
  const completing =
    patch.status === "Completed" &&
    existing.status !== "Completed" &&
    existing.calendar_event_id;
  if (completing) {
    patch.calendar_event_id = null;
    patch.calendar_scheduled_day = null;
    patch.calendar_scheduled_time = null;
  }

  // Clearing the appointment day (or time) on a lead that already has a
  // Google Calendar event should also tear that event down. Otherwise
  // pressing "Remove date & time" leaves a phantom event on the calendar
  // with no UI path back — the resync button disables itself the moment
  // scheduled_day is null, and the user has no way to clean up.
  const clearingSchedule =
    ("scheduled_day" in patch && patch.scheduled_day === null) ||
    ("scheduled_time" in patch && patch.scheduled_time === null);
  // Setting a flex window intentionally nulls scheduled_time but the lead
  // is still meant to be on this day — it's just "any time in the window"
  // instead of a pinned minute. The calendar event's specific time is no
  // longer accurate, so tear the event down, but do NOT demote the status.
  const settingFlexWindow =
    "flex_window" in patch &&
    patch.flex_window !== null &&
    patch.flex_window !== undefined;
  const unbookingCalendar =
    !completing && clearingSchedule && existing.calendar_event_id;
  if (unbookingCalendar) {
    patch.calendar_event_id = null;
    patch.calendar_scheduled_day = null;
    patch.calendar_scheduled_time = null;
    // Demote the lead back to "Called / No Response" so it reappears in the
    // pre-booked buckets instead of lingering as "Scheduled" with no time.
    // Exception: when a flex_window is being set, the lead is still booked
    // on this day — just without a pinned time. Leave the status alone.
    if (
      existing.status === "Scheduled" &&
      !("status" in patch) &&
      !settingFlexWindow
    ) {
      patch.status = "Called / No Response";
    }
  }

  let updateQuery = supabase
    .from("leads")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId);
  if (expectedUpdatedAt) updateQuery = updateQuery.eq("updated_at", expectedUpdatedAt);
  const { data, error } = await updateQuery.select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    // Either the row vanished mid-flight or the expected_updated_at
    // didn't match. Re-read to distinguish and hand the client the
    // current row so it can reconcile its UI instead of silently
    // losing the edit.
    const { data: current } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle();
    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          "This lead was updated by someone else since you loaded it. Reload to see the latest version, then reapply your edit.",
        reason: "stale_write",
        lead: current,
      },
      { status: 409 }
    );
  }

  // Best-effort Google delete after the DB write using THIS user's token.
  // A workspace member who has not connected their own calendar yet will
  // silently skip — the lead is still Completed / unscheduled locally.
  // Log lifecycle transitions. Fire-and-forget (errors swallowed) so an
  // activity-log failure never blocks the actual lead update. Status
  // changes drive the only auto-logged events — `lead_intake` is logged
  // at row creation (see /api/leads POST and the backfill in the
  // migration), so we don't need to log that here.
  if (
    typeof patch.status === "string" &&
    patch.status !== existing.status
  ) {
    let activityType: "lead_scheduled" | "lead_completed" | null = null;
    if (patch.status === "Scheduled") activityType = "lead_scheduled";
    else if (patch.status === "Completed") activityType = "lead_completed";
    if (activityType) {
      try {
        await supabase.from("lead_activities").insert({
          workspace_id: auth.workspaceId,
          lead_id: id,
          type: activityType,
          details: { from: existing.status, to: patch.status },
        });
      } catch {
        // Non-blocking.
      }
    }
  }

  if ((completing || unbookingCalendar) && existing.calendar_event_id) {
    const token = await getAccessToken(auth.userId);
    if (token) {
      try {
        await deleteCalendarEvent(token, existing.calendar_event_id);
      } catch {
        // Swallow: the lead is already updated locally; a stale Google
        // event is recoverable but blocking the status flip isn't.
      }
    }
  }

  return NextResponse.json({ lead: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();
  const { error, count } = await supabase
    .from("leads")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
