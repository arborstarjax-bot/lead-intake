import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { EDITABLE_COLUMNS, LEAD_STATUSES } from "@/lib/types";
import { displayName, normalizeEmail, normalizePhone, normalizeState, normalizeZip } from "@/lib/format";
import { getAccessToken } from "@/lib/google/oauth";
import { deleteCalendarEvent } from "@/lib/google/calendar";
import { requireMembership } from "@/lib/auth";

export const runtime = "nodejs";

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
    .select("id, workspace_id, status, calendar_event_id, first_name, last_name, client")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.workspace_id !== auth.workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
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

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort Google delete after the DB write using THIS user's token.
  // A workspace member who has not connected their own calendar yet will
  // silently skip — the lead is still Completed locally.
  if (completing && existing.calendar_event_id) {
    const token = await getAccessToken(auth.userId);
    if (token) {
      try {
        await deleteCalendarEvent(token, existing.calendar_event_id);
      } catch {
        // Swallow: the lead is already Completed locally; a stale Google
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
