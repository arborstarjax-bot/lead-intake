import "server-only";
import { sendWorkspacePush } from "@/lib/push";

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
        return { ok: true };
      }

      const contentType = res.headers.get("content-type") || "";
      let errText = `HTTP ${res.status}`;
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => null);
        errText = data?.reason || data?.error || errText;
      }

      console.warn(`[SingleOpsSync] Attempt ${attempt}/${maxRetries} failed: ${errText}`);
      if (attempt === maxRetries) {
        sendWorkspacePush({
          workspaceId,
          title: "SingleOps Sync Failed",
          body: `Could not update ${payload.clientName} in SingleOps: ${errText}`,
          url: "/leads",
          tag: `singleops-sync-fail-${payload.leadId}`,
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
      let errText = `HTTP ${res.status}`;
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => null);
        errText = data?.reason || data?.error || errText;
      }

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

    const contentType = res.headers.get("content-type") || "";
    let errText: string;
    if (contentType.includes("application/json")) {
      const data = await res.json().catch(() => null);
      errText = data?.reason || data?.error || `HTTP ${res.status}`;
    } else {
      errText = await res.text().catch(() => `HTTP ${res.status}`);
      errText = errText.slice(0, 200);
    }
    return { ok: false, error: errText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { ok: false, error: msg };
  }
}
