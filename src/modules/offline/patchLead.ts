import { fetchWithOfflineQueue } from "./queue";
import type { Lead } from "@/modules/leads/model";

/**
 * Wrap a PATCH against /api/leads/{id} with an optimistic-concurrency
 * guard. Callers pass the snapshot of the lead they read, and the
 * helper serializes its `updated_at` into `expected_updated_at` on the
 * body — the server's PATCH route rejects with 409 `stale_write` and
 * the latest lead row if another writer advanced `updated_at` since.
 *
 * This closes the race that was only partially addressed in PR #123,
 * where the guard was wired into LeadTable but not the SchedulePanel /
 * EstimateRow / ScheduleModal / StandaloneLeadCard paths.
 */
export async function patchLead(
  id: string,
  patch: Partial<Lead>,
  snapshot: { updated_at?: string | null } | null | undefined,
  options: { offlineQueue?: boolean; label?: string } = {}
): Promise<Response> {
  const body: Partial<Lead> & { expected_updated_at?: string } = { ...patch };
  if (snapshot?.updated_at) body.expected_updated_at = snapshot.updated_at;
  const init: RequestInit = {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (options.offlineQueue) {
    return fetchWithOfflineQueue(`/api/leads/${id}`, {
      ...init,
      label: options.label,
    });
  }
  return fetch(`/api/leads/${id}`, init);
}

/**
 * Pick a user-facing error message out of a non-2xx lead PATCH. Keeps
 * the "someone else edited" wording consistent across screens.
 */
export function formatLeadPatchError(
  res: Response,
  json: { error?: string; reason?: string } | null,
  fallback = "Save failed"
): string {
  if (res.status === 409 && json?.reason === "stale_write") {
    return "Someone else just edited this lead — refresh and try again.";
  }
  return json?.error ?? fallback;
}
