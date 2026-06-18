import "server-only";
import { createAdminClient } from "@/modules/shared/supabase/server";

export interface AuditLogEntry {
  workspace_id: string;
  entity_type: "lead" | "task";
  entity_id?: string;
  entity_name?: string;
  action:
    | "created"
    | "updated"
    | "completed"
    | "rescheduled"
    | "cancelled"
    | "synced_to_singleops"
    | "synced_from_singleops"
    | "sync_failed";
  direction:
    | "leadflow_to_singleops"
    | "singleops_to_leadflow"
    | "internal";
  details?: Record<string, unknown>;
  status?: "success" | "failed" | "pending";
  error_message?: string;
}

/**
 * Write one or more entries to the sync audit log.
 * Non-blocking — errors are swallowed so audit logging
 * never breaks the primary sync flow.
 */
export async function logSyncAudit(
  entries: AuditLogEntry | AuditLogEntry[],
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const rows = (Array.isArray(entries) ? entries : [entries]).map((e) => ({
      workspace_id: e.workspace_id,
      entity_type: e.entity_type,
      entity_id: e.entity_id ?? null,
      entity_name: e.entity_name ?? null,
      action: e.action,
      direction: e.direction,
      details: e.details ?? {},
      status: e.status ?? "success",
      error_message: e.error_message ?? null,
    }));
    await supabase.from("sync_audit_log").insert(rows);
  } catch {
    // Non-blocking — audit log failure must not affect sync
  }
}
