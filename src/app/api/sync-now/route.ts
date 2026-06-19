import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/modules/auth/server";
import { triggerCalendarSync, syncScheduleToSingleOps, syncCompletionToSingleOps, syncTaskToSingleOps } from "@/lib/singleops-sync";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/modules/shared/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/sync-now
 * Trigger an immediate calendar sync via ArborBridge, or push a
 * single task's schedule/completion to SingleOps.
 *
 * Body: { action?: "push-task" | "push-complete", ... }
 */
export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (action === "push-task") {
    const { taskId, singleopsTaskId, clientName, scheduledDate, scheduledTime } = body;

    if (singleopsTaskId) {
      // Existing SingleOps task — reschedule it
      const settings = await getSettings(auth.workspaceId);
      const result = await syncScheduleToSingleOps(
        {
          leadId: taskId || "",
          clientName: clientName || "Task",
          singleopsTaskId,
          scheduledDate,
          scheduledTime,
          timezone: settings.timezone,
        },
        auth.workspaceId,
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error || "Push failed" }, { status: 502 });
      }
      return NextResponse.json({ ok: true });
    }

    // No SingleOps task ID — create a new estimate
    if (!taskId || !scheduledDate) {
      return NextResponse.json({ error: "taskId and scheduledDate required" }, { status: 400 });
    }
    const settings = await getSettings(auth.workspaceId);
    const addr = body.address || null;
    const syncResult = await syncTaskToSingleOps(
      {
        taskId,
        taskName: clientName || "Task",
        clientName: clientName || "Task",
        notes: body.notes ?? null,
        scheduledDate,
        scheduledTime: scheduledTime ?? null,
        address: addr,
        assignee: body.assignee ?? null,
        leadSource: null,
      },
      auth.workspaceId,
    );
    if (syncResult.ok && syncResult.singleopsTaskId) {
      // Save the new SingleOps ID back to the task record
      const supabase = createAdminClient();
      await supabase
        .from("tasks")
        .update({
          singleops_task_id: syncResult.singleopsTaskId,
          singleops_sync_status: "synced",
          singleops_last_synced_at: new Date().toISOString(),
        })
        .eq("id", taskId);
    }
    if (!syncResult.ok) {
      return NextResponse.json({ error: syncResult.error || "Push failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, singleopsTaskId: syncResult.singleopsTaskId });
  }

  if (action === "push-complete") {
    const { taskId, singleopsTaskId, clientName } = body;
    if (!singleopsTaskId) {
      return NextResponse.json({ error: "singleopsTaskId required" }, { status: 400 });
    }
    const result = await syncCompletionToSingleOps(
      {
        leadId: taskId || "",
        clientName: clientName || "Task",
        singleopsTaskId,
      },
      auth.workspaceId,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Push failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  // Default: trigger full calendar sync
  const result = await triggerCalendarSync();

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    entriesFound: result.entriesFound,
    changesDetected: result.changesDetected,
    syncedToLeadFlow: result.syncedToLeadFlow,
  });
}
