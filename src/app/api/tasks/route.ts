import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { getSettings } from "@/lib/settings";
import { nextOccurrenceDate } from "@/modules/tasks/model";
import { syncTaskToSingleOps } from "@/lib/singleops-sync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const status = req.nextUrl.searchParams.get("status");

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .order("start_at", { ascending: true });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const payload = await req.json().catch(() => ({}));
  const { workspace_id: _drop, ...safe } = payload ?? {};
  void _drop;

  if (!safe.name || !safe.start_at || !safe.end_at) {
    return NextResponse.json(
      { error: "name, start_at, and end_at are required" },
      { status: 400 },
    );
  }

  // Default assignee to workspace default salesperson if not set
  if (!safe.assignee) {
    try {
      const settings = await getSettings(auth.workspaceId);
      if (settings.default_salesperson) {
        safe.assignee = settings.default_salesperson;
      }
    } catch {
      // Non-blocking
    }
  }

  // Auto-generate task name: "Assignee - Task" if not provided with that pattern
  if (safe.assignee && !safe.name.includes(" - ")) {
    safe.name = `${safe.assignee} - ${safe.name}`;
  }

  const row = {
    ...safe,
    workspace_id: auth.workspaceId,
    created_by: auth.userId,
    status: safe.status || "Scheduled",
    extraction_source: safe.extraction_source || "manual",
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-generate future occurrences for recurring tasks (4-week lookahead)
  if (data && safe.recurrence_rule) {
    void generateRecurringOccurrences(
      supabase,
      data,
      safe.recurrence_rule,
      auth.workspaceId,
      auth.userId,
    ).catch(() => {});
  }

  // Auto-sync task to SingleOps if workspace has auto-sync enabled
  if (data) {
    try {
      const settings = await getSettings(auth.workspaceId);
      if (settings.auto_sync_to_singleops) {
        const startAt = new Date(data.start_at);
        const scheduledDate = startAt.toISOString().split("T")[0];
        const scheduledTime = `${String(startAt.getHours()).padStart(2, "0")}:${String(startAt.getMinutes()).padStart(2, "0")}`;
        const addr = [data.address, data.city, data.state, data.zip]
          .filter(Boolean)
          .join(", ") || null;

        // Extract client name from task name (format: "ClientName - TaskType")
        const nameParts = data.name.split(" - ");
        const clientName = nameParts.length > 1 ? nameParts[0].trim() : data.name;

        const syncResult = await syncTaskToSingleOps(
          {
            taskId: data.id,
            taskName: data.name,
            clientName,
            notes: data.notes ?? null,
            scheduledDate,
            scheduledTime,
            address: addr,
            assignee: data.assignee ?? null,
            leadSource: null,
          },
          auth.workspaceId,
        );

        // Save the SingleOps task ID back to our record
        if (syncResult.ok && syncResult.singleopsTaskId) {
          await supabase
            .from("tasks")
            .update({
              singleops_task_id: syncResult.singleopsTaskId,
              singleops_sync_status: "synced",
              singleops_last_synced_at: new Date().toISOString(),
            })
            .eq("id", data.id);
        } else if (!syncResult.ok) {
          await supabase
            .from("tasks")
            .update({
              singleops_sync_status: "failed",
              singleops_sync_error: syncResult.error ?? null,
            })
            .eq("id", data.id);
        }
      }
    } catch {
      // Non-blocking — sync failure shouldn't break task creation
    }
  }

  return NextResponse.json({ task: data });
}

/**
 * Generate future occurrences for a recurring task up to 4 weeks ahead.
 * Each occurrence is a separate task row linked to the parent via parent_task_id.
 */
async function generateRecurringOccurrences(
  supabase: ReturnType<typeof createAdminClient>,
  parent: Record<string, unknown>,
  rule: string,
  workspaceId: string,
  userId: string,
) {
  const LOOKAHEAD_DAYS = 28; // 4 weeks
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + LOOKAHEAD_DAYS);

  const startAt = new Date(parent.start_at as string);
  const endAt = new Date(parent.end_at as string);
  const durationMs = endAt.getTime() - startAt.getTime();

  const rows: Record<string, unknown>[] = [];
  let cursor = startAt;
  let idx = 1;
  const endDate = parent.recurrence_end_date
    ? new Date(parent.recurrence_end_date as string)
    : null;
  const endCount = (parent.recurrence_end_count as number) ?? null;

  while (true) {
    const next = nextOccurrenceDate(cursor, rule);
    if (!next || next > cutoff) break;
    if (endDate && next > endDate) break;
    if (endCount && idx >= endCount) break;
    idx++;

    rows.push({
      workspace_id: workspaceId,
      created_by: userId,
      name: parent.name,
      notes: parent.notes,
      status: "Scheduled",
      start_at: next.toISOString(),
      end_at: new Date(next.getTime() + durationMs).toISOString(),
      address: parent.address,
      city: parent.city,
      state: parent.state,
      zip: parent.zip,
      assignee: parent.assignee,
      extraction_source: "manual",
      recurrence_rule: rule,
      parent_task_id: parent.id,
      occurrence_index: idx,
    });

    cursor = next;
  }

  if (rows.length > 0) {
    // Also mark the parent as occurrence_index=1
    await supabase
      .from("tasks")
      .update({ occurrence_index: 1 })
      .eq("id", parent.id as string);

    await supabase.from("tasks").insert(rows);
  }
}
