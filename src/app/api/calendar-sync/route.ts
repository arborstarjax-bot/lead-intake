import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  displayName,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from "@/modules/shared/format";
import { sendWorkspacePush } from "@/lib/push";
import { getSettings } from "@/lib/settings";
import { syncCompletionToSingleOps } from "@/lib/singleops-sync";
import { detectLeadSource } from "./detect-lead-source";
import { logSyncAudit, type AuditLogEntry } from "@/lib/sync-audit";

export const runtime = "nodejs";

interface CalendarSyncEntry {
  clientName: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  assignedRep: string | null;
  changeType: "new" | "rescheduled" | "cancelled" | "rep_changed" | "updated" | "completed";
  previousDate?: string | null;
  previousTime?: string | null;
  sourceLeadId?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  singleopsTaskId?: string | null;
  jobStatus?: string | null;
  isTask?: boolean;
}

/**
 * POST /api/calendar-sync
 *
 * Receives calendar entries from ArborBridge's background sync agent.
 * For each entry, creates a new lead card (or updates an existing one)
 * so Lead Flow stays in sync with the SingleOps calendar.
 *
 * Auth: x-api-key header matching ARBORBRIDGE_API_KEY env var.
 */
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.ARBORBRIDGE_API_KEY;

  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.entries || !Array.isArray(body.entries)) {
    return NextResponse.json(
      { error: "Request body must contain an 'entries' array" },
      { status: 400 }
    );
  }

  const workspaceId = body.workspaceId as string | undefined;
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const entries = body.entries as CalendarSyncEntry[];

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const newLeadNames: string[] = [];
  const rescheduledLeadNames: string[] = [];
  const cancelledLeadNames: string[] = [];
  const repChangedLeadNames: string[] = [];
  const completedLeadNames: string[] = [];
  const pushCompletionQueue: Array<{
    leadId: string;
    clientName: string;
    singleopsTaskId: string;
  }> = [];
  const detectedSources = new Set<string>();
  const newTaskNames: string[] = [];
  const completedTaskNames: string[] = [];
  const auditEntries: AuditLogEntry[] = [];

  for (const entry of entries) {
    try {
      if (!entry.clientName || !entry.scheduledDate) {
        skipped++;
        continue;
      }

      // Handle non-estimate tasks separately — sync to tasks table
      if (entry.isTask) {
        const taskResult = await syncTaskEntry(supabase, workspaceId, entry);
        if (taskResult === "new") newTaskNames.push(entry.clientName);
        if (taskResult === "completed") completedTaskNames.push(entry.clientName);
        synced++;
        continue;
      }

      // Parse client name into first/last
      const firstName = entry.firstName || parseFirstName(entry.clientName);
      const lastName = entry.lastName || parseLastName(entry.clientName);
      const client = entry.clientName;

      // Check if this lead already exists (by sourceLeadId or by client+date match)
      let existingLead = null;

      if (entry.sourceLeadId) {
        const { data } = await supabase
          .from("leads")
          .select("id, status, scheduled_day, scheduled_time, sales_person, lead_source, lead_type, singleops_task_id")
          .eq("workspace_id", workspaceId)
          .eq("id", entry.sourceLeadId)
          .maybeSingle();
        existingLead = data;
      }

      if (!existingLead) {
        // Try matching by client name + scheduled date
        const { data } = await supabase
          .from("leads")
          .select("id, status, scheduled_day, scheduled_time, sales_person, lead_source, lead_type, singleops_task_id")
          .eq("workspace_id", workspaceId)
          .ilike("client", client)
          .eq("scheduled_day", entry.scheduledDate)
          .maybeSingle();
        existingLead = data;
      }

      if (!existingLead && entry.changeType !== "cancelled") {
        // Also check if there's a lead with same client but different date
        // (could be a reschedule — don't create a duplicate)
        const { data: clientMatch } = await supabase
          .from("leads")
          .select("id, status, scheduled_day, scheduled_time, sales_person, calendar_sync_status, lead_source, lead_type, singleops_task_id")
          .eq("workspace_id", workspaceId)
          .ilike("client", client)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (clientMatch && clientMatch.calendar_sync_status === "synced") {
          // Update existing synced lead with new schedule
          existingLead = clientMatch;
        }
      }

      if (entry.changeType === "cancelled") {
        if (existingLead) {
          await supabase
            .from("leads")
            .update({
              scheduled_day: null,
              scheduled_time: null,
              status: existingLead.status === "Scheduled" ? "Called / No Response" : existingLead.status,
              calendar_sync_status: "synced",
              calendar_sync_at: new Date().toISOString(),
            })
            .eq("id", existingLead.id)
            .eq("workspace_id", workspaceId);
          cancelledLeadNames.push(client);
          synced++;
        } else {
          skipped++;
        }
        continue;
      }

      if (existingLead) {
        // Handle completion coming FROM SingleOps: if the task is now
        // completed in SingleOps but the lead is still active in Lead Flow,
        // mark the lead as Completed.
        const isCompletedInSingleOps =
          entry.changeType === "completed" ||
          entry.jobStatus?.toLowerCase().includes("complete") === true;

        if (isCompletedInSingleOps && existingLead.status === "Scheduled") {
          const completionUpdates: Record<string, unknown> = {
            status: "Completed",
            calendar_sync_status: "synced",
            calendar_sync_at: new Date().toISOString(),
          };
          if (entry.singleopsTaskId) completionUpdates.singleops_task_id = entry.singleopsTaskId;
          await supabase
            .from("leads")
            .update(completionUpdates)
            .eq("id", existingLead.id)
            .eq("workspace_id", workspaceId);
          completedLeadNames.push(client);
          synced++;
          continue;
        }

        // Leads in terminal states (Completed, Pending, Lost, Sold) should not
        // have their schedule, rep, or address overwritten by a re-sync.
        // Only update the task-id mapping and sync timestamp so we can
        // still track the link back to SingleOps.
        const TERMINAL_STATUSES = new Set(["Completed", "Pending", "Lost"]);
        if (TERMINAL_STATUSES.has(existingLead.status ?? "")) {
          const touchUpdates: Record<string, unknown> = {
            calendar_sync_status: "synced",
            calendar_sync_at: new Date().toISOString(),
          };
          const taskId = entry.singleopsTaskId || existingLead.singleops_task_id;
          if (entry.singleopsTaskId) touchUpdates.singleops_task_id = entry.singleopsTaskId;
          await supabase
            .from("leads")
            .update(touchUpdates)
            .eq("id", existingLead.id)
            .eq("workspace_id", workspaceId);

          // Queue completion push to SingleOps if the task is still active there.
          // Processed sequentially after the main loop to avoid overloading
          // ArborBridge with parallel Playwright sessions.
          const singleopsStillActive =
            !entry.jobStatus?.toLowerCase().includes("complete") &&
            entry.changeType !== "completed";
          if (taskId && singleopsStillActive) {
            pushCompletionQueue.push({
              leadId: existingLead.id,
              clientName: client,
              singleopsTaskId: taskId,
            });
          }

          synced++;
          continue;
        }

        // Update existing lead (still in active funnel)
        const updates: Record<string, unknown> = {
          scheduled_day: entry.scheduledDate,
          calendar_sync_status: "synced",
          calendar_sync_at: new Date().toISOString(),
        };

        if (entry.scheduledTime) {
          updates.scheduled_time = entry.scheduledTime;
        }

        if (entry.assignedRep && entry.assignedRep !== existingLead.sales_person) {
          updates.sales_person = entry.assignedRep;
          repChangedLeadNames.push(client);
        }

        if (entry.address) updates.address = entry.address;
        if (entry.city) updates.city = entry.city;
        if (entry.state) updates.state = normalizeState(entry.state) ?? entry.state;
        if (entry.zip) updates.zip = normalizeZip(entry.zip) ?? entry.zip;
        if (entry.notes) updates.notes = entry.notes;
        if (entry.singleopsTaskId) updates.singleops_task_id = entry.singleopsTaskId;

        // Promote to Scheduled if the lead is still in an early-funnel status.
        if (existingLead.status !== "Scheduled") {
          updates.status = "Scheduled";
        }

        // Default lead_source and lead_type if not already set
        if (!existingLead.lead_source) {
          updates.lead_source = await detectAndTrack(entry.notes, detectedSources);
        }
        if (!existingLead.lead_type) {
          updates.lead_type = "Residential";
        }

        await supabase
          .from("leads")
          .update(updates)
          .eq("id", existingLead.id)
          .eq("workspace_id", workspaceId);

        // Track schedule changes for push notifications.
        // If the lead previously had no scheduled_day, this is effectively
        // a new calendar appearance — notify as "new" instead of "rescheduled".
        const normalizeTime = (t: string | null) => t?.slice(0, 5) ?? null;
        const hadNoPriorSchedule = !existingLead.scheduled_day;
        const dateChanged = existingLead.scheduled_day !== entry.scheduledDate;
        const timeChanged = entry.scheduledTime && normalizeTime(existingLead.scheduled_time) !== normalizeTime(entry.scheduledTime);
        if (hadNoPriorSchedule || entry.changeType === "new") {
          newLeadNames.push(client);
        } else if (dateChanged || timeChanged) {
          rescheduledLeadNames.push(client);
        }

        synced++;
      } else {
        // Create a new lead card
        const newLead = {
          workspace_id: workspaceId,
          first_name: firstName,
          last_name: lastName,
          client: client,
          phone_number: entry.phone ? (normalizePhone(entry.phone) ?? entry.phone) : null,
          email: entry.email || null,
          address: entry.address || null,
          city: entry.city || null,
          state: entry.state ? (normalizeState(entry.state) ?? entry.state) : null,
          zip: entry.zip ? (normalizeZip(entry.zip) ?? entry.zip) : null,
          sales_person: entry.assignedRep || null,
          scheduled_day: entry.scheduledDate,
          scheduled_time: entry.scheduledTime || null,
          notes: entry.notes || null,
          status: "Scheduled" as const,
          intake_source: "calendar_sync" as const,
          intake_status: "ready" as const,
          lead_source: await detectAndTrack(entry.notes, detectedSources),
          lead_type: "Residential",
          calendar_sync_status: "synced" as const,
          calendar_sync_at: new Date().toISOString(),
          singleops_task_id: entry.singleopsTaskId || null,
        };

        const { data: created, error: insertErr } = await supabase
          .from("leads")
          .insert(newLead)
          .select("id")
          .single();

        if (insertErr) {
          errors.push(`Failed to create lead for ${client}: ${insertErr.message}`);
          failed++;
          continue;
        }

        // Log activity
        if (created) {
          try {
            await supabase.from("lead_activities").insert({
              workspace_id: workspaceId,
              lead_id: created.id,
              type: "lead_intake",
              details: { source: "calendar_sync", from_singleops: true },
            });
          } catch {
            // Non-blocking
          }
        }

        synced++;
        newLeadNames.push(client);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`Error processing ${entry.clientName}: ${msg}`);
      failed++;
    }
  }

  // Auto-add any new AI-detected lead sources to workspace settings
  if (detectedSources.size > 0) {
    try {
      const settings = await getSettings(workspaceId);
      const existingLower = new Set(settings.lead_sources.map((s) => s.toLowerCase()));
      const newSources = [...detectedSources].filter(
        (s) => !existingLower.has(s.toLowerCase())
      );
      if (newSources.length > 0) {
        const otherIdx = settings.lead_sources.findIndex(
          (s) => s.toLowerCase() === "other"
        );
        const updated = otherIdx >= 0
          ? [
              ...settings.lead_sources.slice(0, otherIdx),
              ...newSources,
              ...settings.lead_sources.slice(otherIdx),
            ]
          : [...settings.lead_sources, ...newSources];
        await supabase
          .from("app_settings")
          .update({ lead_sources: updated })
          .eq("workspace_id", workspaceId);
      }
    } catch {
      // Non-blocking
    }
  }

  // Send push notification for newly created leads
  if (newLeadNames.length > 0) {
    try {
      const body = newLeadNames.length === 1
        ? `${newLeadNames[0]} — synced from SingleOps`
        : `${newLeadNames.length} leads synced from SingleOps`;
      await sendWorkspacePush({
        workspaceId,
        title: "Calendar Sync",
        body,
        url: "/leads",
        tag: "calendar-sync",
      });
    } catch {
      // Non-blocking
    }
  }

  // Send push notification for rescheduled leads
  if (rescheduledLeadNames.length > 0) {
    try {
      const body = rescheduledLeadNames.length === 1
        ? `${rescheduledLeadNames[0]} — schedule updated from SingleOps`
        : `${rescheduledLeadNames.length} leads rescheduled from SingleOps`;
      await sendWorkspacePush({
        workspaceId,
        title: "Schedule Change",
        body,
        url: "/leads",
        tag: "calendar-sync-reschedule",
      });
    } catch {
      // Non-blocking
    }
  }

  // Send push notification for cancelled/removed leads
  if (cancelledLeadNames.length > 0) {
    try {
      const body = cancelledLeadNames.length === 1
        ? `${cancelledLeadNames[0]} — removed from SingleOps calendar`
        : `${cancelledLeadNames.length} leads removed from SingleOps calendar`;
      await sendWorkspacePush({
        workspaceId,
        title: "Lead Removed",
        body,
        url: "/leads",
        tag: "calendar-sync-cancelled",
      });
    } catch {
      // Non-blocking
    }
  }

  // Send push notification for rep/salesperson changes
  if (repChangedLeadNames.length > 0) {
    try {
      const body = repChangedLeadNames.length === 1
        ? `${repChangedLeadNames[0]} — rep changed in SingleOps`
        : `${repChangedLeadNames.length} leads reassigned in SingleOps`;
      await sendWorkspacePush({
        workspaceId,
        title: "Rep Change",
        body,
        url: "/leads",
        tag: "calendar-sync-rep-change",
      });
    } catch {
      // Non-blocking
    }
  }

  // Send push notification for leads that SingleOps reported as completed
  if (completedLeadNames.length > 0) {
    try {
      const body = completedLeadNames.length === 1
        ? `${completedLeadNames[0]} — completed in SingleOps`
        : `${completedLeadNames.length} leads completed in SingleOps`;
      await sendWorkspacePush({
        workspaceId,
        title: "Estimate Complete",
        body,
        url: "/leads",
        tag: "calendar-sync-completed",
      });
    } catch {
      // Non-blocking
    }
  }

  // Process queued completion pushbacks to SingleOps sequentially.
  // Each call triggers a Playwright browser session on ArborBridge,
  // so we process one at a time to avoid overloading Docker.
  if (pushCompletionQueue.length > 0) {
    const pushSuccesses: string[] = [];
    const pushFailures: string[] = [];
    for (const item of pushCompletionQueue) {
      try {
        const result = await syncCompletionToSingleOps(item, workspaceId);
        if (result.ok) {
          pushSuccesses.push(item.clientName);
        } else {
          pushFailures.push(item.clientName);
          console.warn(`[CalendarSync] Completion push failed for ${item.clientName}: ${result.error}`);
        }
      } catch {
        pushFailures.push(item.clientName);
      }
    }
    if (pushSuccesses.length > 0) {
      try {
        const body = pushSuccesses.length === 1
          ? `${pushSuccesses[0]} — marked complete in SingleOps`
          : `${pushSuccesses.length} estimates marked complete in SingleOps`;
        await sendWorkspacePush({
          workspaceId,
          title: "Sync: Estimates Completed",
          body,
          url: "/leads",
          tag: "calendar-sync-push-complete",
        });
      } catch {
        // Non-blocking
      }
    }
    if (pushFailures.length > 0) {
      try {
        await sendWorkspacePush({
          workspaceId,
          title: "Sync: Completion Failed",
          body: `Failed to complete ${pushFailures.length} task(s) in SingleOps: ${pushFailures.join(", ")}`,
          url: "/leads",
          tag: "calendar-sync-push-fail",
        });
      } catch {
        // Non-blocking
      }
    }
  }

  // Send notifications for tasks synced from SingleOps
  if (newTaskNames.length > 0) {
    try {
      const body = newTaskNames.length === 1
        ? `${newTaskNames[0]} — task synced from SingleOps`
        : `${newTaskNames.length} tasks synced from SingleOps`;
      await sendWorkspacePush({
        workspaceId,
        title: "Task Sync",
        body,
        url: "/tasks",
        tag: "calendar-sync-new-tasks",
      });
    } catch {
      // Non-blocking
    }
  }
  if (completedTaskNames.length > 0) {
    try {
      const body = completedTaskNames.length === 1
        ? `${completedTaskNames[0]} — task completed in SingleOps`
        : `${completedTaskNames.length} tasks completed in SingleOps`;
      await sendWorkspacePush({
        workspaceId,
        title: "Task Complete",
        body,
        url: "/tasks",
        tag: "calendar-sync-completed-tasks",
      });
    } catch {
      // Non-blocking
    }
  }

  // Write audit log entries for all synced items
  for (const name of newLeadNames) {
    auditEntries.push({
      workspace_id: workspaceId,
      entity_type: "lead",
      entity_name: name,
      action: "synced_from_singleops",
      direction: "singleops_to_leadflow",
      details: { changeType: "new" },
    });
  }
  for (const name of rescheduledLeadNames) {
    auditEntries.push({
      workspace_id: workspaceId,
      entity_type: "lead",
      entity_name: name,
      action: "rescheduled",
      direction: "singleops_to_leadflow",
    });
  }
  for (const name of completedLeadNames) {
    auditEntries.push({
      workspace_id: workspaceId,
      entity_type: "lead",
      entity_name: name,
      action: "completed",
      direction: "singleops_to_leadflow",
    });
  }
  for (const name of newTaskNames) {
    auditEntries.push({
      workspace_id: workspaceId,
      entity_type: "task",
      entity_name: name,
      action: "synced_from_singleops",
      direction: "singleops_to_leadflow",
    });
  }
  for (const name of completedTaskNames) {
    auditEntries.push({
      workspace_id: workspaceId,
      entity_type: "task",
      entity_name: name,
      action: "completed",
      direction: "singleops_to_leadflow",
    });
  }
  if (auditEntries.length > 0) {
    void logSyncAudit(auditEntries).catch(() => {});
  }

  // Include sync_interval_minutes so ArborBridge can adjust its cron
  let syncIntervalMinutes = 15;
  try {
    const wsSettings = await getSettings(workspaceId);
    syncIntervalMinutes = wsSettings.sync_interval_minutes;
  } catch {
    // Fall back to default
  }

  return NextResponse.json({
    synced,
    skipped,
    failed,
    errors: errors.length > 0 ? errors : undefined,
    syncIntervalMinutes,
  });
}

async function detectAndTrack(
  notes: string | null | undefined,
  tracked: Set<string>
): Promise<string> {
  const source = await detectLeadSource(notes);
  tracked.add(source);
  return source;
}

function parseFirstName(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 0 ? parts[0] : null;
}

function parseLastName(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : null;
}

/**
 * Sync a non-estimate task entry from SingleOps into the tasks table.
 * Returns "new", "completed", "updated", or "skipped".
 */
async function syncTaskEntry(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  entry: CalendarSyncEntry,
): Promise<"new" | "completed" | "updated" | "skipped"> {
  const singleopsId = entry.singleopsTaskId;

  // Check if task already exists by SingleOps task ID
  let existingTask = null;
  if (singleopsId) {
    const { data } = await supabase
      .from("tasks")
      .select("id, status, singleops_task_id")
      .eq("workspace_id", workspaceId)
      .eq("singleops_task_id", singleopsId)
      .maybeSingle();
    existingTask = data;
  }

  // Also try matching by name + date if no singleops_task_id match
  if (!existingTask) {
    const { data } = await supabase
      .from("tasks")
      .select("id, status, singleops_task_id")
      .eq("workspace_id", workspaceId)
      .ilike("name", entry.clientName)
      .gte("start_at", `${entry.scheduledDate}T00:00:00`)
      .lte("start_at", `${entry.scheduledDate}T23:59:59`)
      .maybeSingle();
    existingTask = data;
  }

  const isCompleted = entry.jobStatus?.toLowerCase().includes("complete") ||
    entry.changeType === "completed";

  if (existingTask) {
    // Update existing task
    const updates: Record<string, unknown> = {
      singleops_sync_status: "synced",
      singleops_last_synced_at: new Date().toISOString(),
    };
    if (singleopsId && !existingTask.singleops_task_id) {
      updates.singleops_task_id = singleopsId;
    }
    if (isCompleted && existingTask.status !== "Completed") {
      updates.status = "Completed";
      await supabase
        .from("tasks")
        .update(updates)
        .eq("id", existingTask.id)
        .eq("workspace_id", workspaceId);
      return "completed";
    }
    await supabase
      .from("tasks")
      .update(updates)
      .eq("id", existingTask.id)
      .eq("workspace_id", workspaceId);
    return "updated";
  }

  // Create new task from SingleOps
  const startTime = entry.scheduledTime || "09:00";
  const [h, m] = startTime.split(":").map(Number);
  const startAt = new Date(`${entry.scheduledDate}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000); // 1 hour default

  await supabase.from("tasks").insert({
    workspace_id: workspaceId,
    name: entry.clientName,
    notes: entry.notes ?? null,
    status: isCompleted ? "Completed" : "Scheduled",
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    address: entry.address ?? null,
    city: entry.city ?? null,
    state: entry.state ?? null,
    zip: entry.zip ?? null,
    assignee: entry.assignedRep ?? null,
    extraction_source: "manual",
    singleops_task_id: singleopsId ?? null,
    singleops_sync_status: "synced",
    singleops_last_synced_at: new Date().toISOString(),
  });

  return isCompleted ? "completed" : "new";
}
