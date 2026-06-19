import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/modules/auth/server";
import { triggerCalendarSync, syncScheduleToSingleOps, syncCompletionToSingleOps } from "@/lib/singleops-sync";
import { getSettings } from "@/lib/settings";

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
    if (!singleopsTaskId) {
      return NextResponse.json({ error: "singleopsTaskId required" }, { status: 400 });
    }
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
