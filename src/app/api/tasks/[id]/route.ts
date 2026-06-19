import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { getSettings } from "@/lib/settings";
import { TASK_EDITABLE_COLUMNS, nextOccurrenceDate } from "@/modules/tasks/model";
import { syncCompletionToSingleOps, syncScheduleToSingleOps } from "@/lib/singleops-sync";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  // Verify ownership
  const { data: existing } = await supabase
    .from("tasks")
    .select("id, status, recurrence_rule, parent_task_id, start_at, end_at, name, notes, address, city, state, zip, assignee, recurrence_end_date, recurrence_end_count, occurrence_index, singleops_task_id")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  for (const key of TASK_EDITABLE_COLUMNS) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // When a recurring task is completed, check if there's a next occurrence
  // already generated. If not (we're at the edge of the 4-week window),
  // generate the next one so there's always a future occurrence.
  const completingRecurring =
    updates.status === "Completed" &&
    existing.status !== "Completed" &&
    (existing.recurrence_rule || existing.parent_task_id);
  if (completingRecurring && data) {
    const rule = existing.recurrence_rule as string;
    const parentId = (existing.parent_task_id ?? existing.id) as string;
    if (rule) {
      // Check if there's already a future occurrence
      const { count } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .or(`parent_task_id.eq.${parentId},id.eq.${parentId}`)
        .eq("workspace_id", auth.workspaceId)
        .eq("status", "Scheduled")
        .gt("start_at", new Date().toISOString());

      // If no future scheduled occurrences, generate the next one
      if ((count ?? 0) === 0) {
        const currentStart = new Date(existing.start_at);
        const durationMs =
          new Date(existing.end_at).getTime() - currentStart.getTime();
        const next = nextOccurrenceDate(currentStart, rule);
        const endDate = existing.recurrence_end_date
          ? new Date(existing.recurrence_end_date)
          : null;
        if (next && (!endDate || next <= endDate)) {
          await supabase.from("tasks").insert({
            workspace_id: auth.workspaceId,
            created_by: auth.userId,
            name: existing.name,
            notes: existing.notes,
            status: "Scheduled",
            start_at: next.toISOString(),
            end_at: new Date(next.getTime() + durationMs).toISOString(),
            address: existing.address,
            city: existing.city,
            state: existing.state,
            zip: existing.zip,
            assignee: existing.assignee,
            extraction_source: "manual",
            recurrence_rule: rule,
            parent_task_id: parentId,
            occurrence_index: (existing.occurrence_index ?? 1) + 1,
          });
        }
      }
    }
  }

  // Push task reschedule to SingleOps if start_at changed
  if (
    updates.start_at &&
    existing.singleops_task_id &&
    String(updates.start_at) !== String(existing.start_at)
  ) {
    try {
      const settings = await getSettings(auth.workspaceId);
      if (settings.auto_sync_to_singleops) {
        const newStart = new Date(updates.start_at as string);
        const tz = "America/New_York";
        const localStart = new Date(newStart.toLocaleString("en-US", { timeZone: tz }));
        const scheduledDate = `${localStart.getFullYear()}-${String(localStart.getMonth() + 1).padStart(2, "0")}-${String(localStart.getDate()).padStart(2, "0")}`;
        const scheduledTime = `${String(localStart.getHours()).padStart(2, "0")}:${String(localStart.getMinutes()).padStart(2, "0")}`;
        void syncScheduleToSingleOps(
          {
            leadId: id,
            clientName: existing.name as string,
            singleopsTaskId: existing.singleops_task_id as string,
            scheduledDate,
            scheduledTime,
            timezone: "America/New_York",
          },
          auth.workspaceId,
        ).catch(() => {});
      }
    } catch {
      // Non-blocking
    }
  }

  // Push task completion to SingleOps if the task has a sync ID
  if (
    updates.status === "Completed" &&
    existing.status !== "Completed" &&
    existing.singleops_task_id
  ) {
    try {
      const settings = await getSettings(auth.workspaceId);
      if (settings.auto_sync_to_singleops) {
        void syncCompletionToSingleOps(
          {
            leadId: id,
            clientName: existing.name as string,
            singleopsTaskId: existing.singleops_task_id as string,
          },
          auth.workspaceId,
        ).catch(() => {});
      }
    } catch {
      // Non-blocking
    }
  }

  return NextResponse.json({ task: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();
  const deleteFuture = req.nextUrl.searchParams.get("future") === "true";

  if (deleteFuture) {
    // Delete this task AND all future occurrences with the same parent
    const { data: task } = await supabase
      .from("tasks")
      .select("id, parent_task_id, start_at, recurrence_rule")
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle();

    if (task) {
      const parentId = task.parent_task_id ?? task.id;

      // Delete future occurrences (same parent, starts on or after this task)
      await supabase
        .from("tasks")
        .delete()
        .eq("workspace_id", auth.workspaceId)
        .or(`parent_task_id.eq.${parentId},id.eq.${parentId}`)
        .gte("start_at", task.start_at);

      // If the parent itself was not this task, stop recurrence on the parent
      if (task.parent_task_id) {
        await supabase
          .from("tasks")
          .update({ recurrence_rule: null })
          .eq("id", task.parent_task_id)
          .eq("workspace_id", auth.workspaceId);
      }
    }
  } else {
    // Just delete this single task
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
