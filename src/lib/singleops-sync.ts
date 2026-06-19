import "server-only";
import { sendWorkspacePush } from "@/lib/push";
import { logSyncAudit } from "@/lib/sync-audit";

interface ScheduleUpdatePayload {
  leadId: string;
  clientName: string;
  singleopsTaskId: string;
  scheduledDate: string;
  scheduledTime: string | null;
  timezone: string;
}

/**
 * Push a schedule change from Lead Flow to ArborBridge, which will
 * update the task in SingleOps via Playwright.
 *
 * Retries up to 3 times with exponential backoff. On final failure,
 * sends a push notification so the user knows the sync didn't land.
 */
export async function syncScheduleToSingleOps(
  payload: ScheduleUpdatePayload,
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const arborbridgeUrl = process.env.ARBORBRIDGE_URL;
  const arborbridgeApiKey = process.env.ARBORBRIDGE_API_KEY;

  if (!arborbridgeUrl || !arborbridgeApiKey) {
    console.warn("[SingleOpsSync] Skipped: ARBORBRIDGE_URL or ARBORBRIDGE_API_KEY not set");
    return { ok: false, error: "ArborBridge not configured" };
  }

  console.log(`[SingleOpsSync] Pushing schedule change for ${payload.clientName} (task ${payload.singleopsTaskId}) to ${arborbridgeUrl}`);

  const url = `${arborbridgeUrl.replace(/\/$/, "")}/api/schedule-update`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": arborbridgeApiKey,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        console.log(`[SingleOpsSync] Success: ${payload.clientName} synced to SingleOps`);
        void logSyncAudit({
          workspace_id: workspaceId,
          entity_type: "lead",
          entity_id: payload.leadId,
          entity_name: payload.clientName,
          action: "rescheduled",
          direction: "leadflow_to_singleops",
          details: { scheduledDate: payload.scheduledDate, scheduledTime: payload.scheduledTime },
        }).catch(() => {});
        return { ok: true };
      }

      const contentType = res.headers.get("content-type") || "";
      const errText = contentType.includes("application/json")
        ? (await res.json()).error || `HTTP ${res.status}`
        : `HTTP ${res.status}`;

      console.warn(`[SingleOpsSync] Attempt ${attempt}/${maxRetries} failed: ${errText}`);
      if (attempt === maxRetries) {
        sendWorkspacePush({
          workspaceId,
          title: "SingleOps Sync Failed",
          body: `Could not update ${payload.clientName} in SingleOps: ${errText}`,
          url: "/leads",
          tag: `singleops-sync-fail-${payload.leadId}`,
        }).catch(() => {});
        void logSyncAudit({
          workspace_id: workspaceId,
          entity_type: "lead",
          entity_id: payload.leadId,
          entity_name: payload.clientName,
          action: "sync_failed",
          direction: "leadflow_to_singleops",
          status: "failed",
          error_message: errText,
        }).catch(() => {});

        return { ok: false, error: errText };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      console.warn(`[SingleOpsSync] Attempt ${attempt}/${maxRetries} network error: ${msg}`);
      if (attempt === maxRetries) {
        sendWorkspacePush({
          workspaceId,
          title: "SingleOps Sync Failed",
          body: `Could not reach ArborBridge to update ${payload.clientName}: ${msg}`,
          url: "/leads",
          tag: `singleops-sync-fail-${payload.leadId}`,
        }).catch(() => {});

        return { ok: false, error: msg };
      }
    }

    // Exponential backoff: 1s, 2s, 4s
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
  }

  return { ok: false, error: "Max retries exceeded" };
}

interface TaskCompletePayload {
  leadId: string;
  clientName: string;
  singleopsTaskId: string;
}

/**
 * Mark a SingleOps task as Complete via ArborBridge Playwright automation.
 * Fires when a lead is marked Completed in Lead Flow.
 */
export async function syncCompletionToSingleOps(
  payload: TaskCompletePayload,
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const arborbridgeUrl = process.env.ARBORBRIDGE_URL;
  const arborbridgeApiKey = process.env.ARBORBRIDGE_API_KEY;

  if (!arborbridgeUrl || !arborbridgeApiKey) {
    console.warn("[SingleOpsSync] Skipped completion: ARBORBRIDGE_URL or ARBORBRIDGE_API_KEY not set");
    return { ok: false, error: "ArborBridge not configured" };
  }

  console.log(`[SingleOpsSync] Marking task ${payload.singleopsTaskId} complete for ${payload.clientName}`);

  const url = `${arborbridgeUrl.replace(/\/$/, "")}/api/task-complete`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": arborbridgeApiKey,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        console.log(`[SingleOpsSync] Success: ${payload.clientName} task marked complete in SingleOps`);
        return { ok: true };
      }

      const contentType = res.headers.get("content-type") || "";
      const errText = contentType.includes("application/json")
        ? (await res.json()).error || `HTTP ${res.status}`
        : `HTTP ${res.status}`;

      console.warn(`[SingleOpsSync] Complete attempt ${attempt}/${maxRetries} failed: ${errText}`);
      if (attempt === maxRetries) {
        sendWorkspacePush({
          workspaceId,
          title: "SingleOps Complete Failed",
          body: `Could not mark ${payload.clientName} as complete in SingleOps: ${errText}`,
          url: "/leads",
          tag: `singleops-complete-fail-${payload.leadId}`,
        }).catch(() => {});

        return { ok: false, error: errText };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      console.warn(`[SingleOpsSync] Complete attempt ${attempt}/${maxRetries} network error: ${msg}`);
      if (attempt === maxRetries) {
        sendWorkspacePush({
          workspaceId,
          title: "SingleOps Complete Failed",
          body: `Could not reach ArborBridge to complete ${payload.clientName}: ${msg}`,
          url: "/leads",
          tag: `singleops-complete-fail-${payload.leadId}`,
        }).catch(() => {});

        return { ok: false, error: msg };
      }
    }

    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
  }

  return { ok: false, error: "Max retries exceeded" };
}

interface TaskCreatePayload {
  taskId: string;
  taskName: string;
  clientName: string;
  notes: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  address: string | null;
  assignee: string | null;
  leadSource: string | null;
}

/**
 * Create a task in SingleOps via ArborBridge Playwright automation.
 * Returns the new SingleOps task ID if available.
 */
export async function syncTaskToSingleOps(
  payload: TaskCreatePayload,
  workspaceId: string,
): Promise<{ ok: boolean; singleopsTaskId?: string; error?: string }> {
  const arborbridgeUrl = process.env.ARBORBRIDGE_URL;
  const arborbridgeApiKey = process.env.ARBORBRIDGE_API_KEY;

  if (!arborbridgeUrl || !arborbridgeApiKey) {
    console.warn("[SingleOpsSync] Skipped task create: ARBORBRIDGE_URL or ARBORBRIDGE_API_KEY not set");
    return { ok: false, error: "ArborBridge not configured" };
  }

  console.log(`[SingleOpsSync] Creating task "${payload.taskName}" in SingleOps`);

  const url = `${arborbridgeUrl.replace(/\/$/, "")}/api/task-create`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": arborbridgeApiKey,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`[SingleOpsSync] Task "${payload.taskName}" created in SingleOps`);
        return { ok: true, singleopsTaskId: data.singleopsTaskId ?? undefined };
      }

      const contentType = res.headers.get("content-type") || "";
      const errText = contentType.includes("application/json")
        ? (await res.json()).error || `HTTP ${res.status}`
        : `HTTP ${res.status}`;

      console.warn(`[SingleOpsSync] Task create attempt ${attempt}/${maxRetries} failed: ${errText}`);
      if (attempt === maxRetries) {
        sendWorkspacePush({
          workspaceId,
          title: "SingleOps Task Create Failed",
          body: `Could not create "${payload.taskName}" in SingleOps: ${errText}`,
          url: "/tasks",
          tag: `singleops-task-create-fail-${payload.taskId}`,
        }).catch(() => {});
        return { ok: false, error: errText };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      console.warn(`[SingleOpsSync] Task create attempt ${attempt}/${maxRetries} network error: ${msg}`);
      if (attempt === maxRetries) {
        sendWorkspacePush({
          workspaceId,
          title: "SingleOps Task Create Failed",
          body: `Could not reach ArborBridge to create "${payload.taskName}": ${msg}`,
          url: "/tasks",
          tag: `singleops-task-create-fail-${payload.taskId}`,
        }).catch(() => {});
        return { ok: false, error: msg };
      }
    }

    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
  }

  return { ok: false, error: "Max retries exceeded" };
}

/**
 * Ask ArborBridge to run an immediate calendar sync cycle.
 * Returns the sync result from ArborBridge.
 */
export async function triggerCalendarSync(): Promise<{
  ok: boolean;
  entriesFound?: number;
  changesDetected?: number;
  syncedToLeadFlow?: number;
  error?: string;
}> {
  const arborbridgeUrl = process.env.ARBORBRIDGE_URL;
  const arborbridgeApiKey = process.env.ARBORBRIDGE_API_KEY;

  if (!arborbridgeUrl || !arborbridgeApiKey) {
    return { ok: false, error: "ArborBridge not configured" };
  }

  const url = `${arborbridgeUrl.replace(/\/$/, "")}/api/sync-now`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": arborbridgeApiKey,
      },
    });

    if (res.ok) {
      const data = await res.json();
      return {
        ok: true,
        entriesFound: data.entriesFound ?? 0,
        changesDetected: data.changesDetected ?? 0,
        syncedToLeadFlow: data.syncedToLeadFlow ?? 0,
      };
    }

    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, error: text.slice(0, 200) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: msg };
  }
}
