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
