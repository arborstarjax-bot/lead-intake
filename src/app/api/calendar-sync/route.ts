import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  displayName,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from "@/modules/shared/format";
import { sendWorkspacePush } from "@/lib/push";

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
  changeType: "new" | "rescheduled" | "cancelled" | "rep_changed" | "updated";
  previousDate?: string | null;
  previousTime?: string | null;
  sourceLeadId?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
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

  for (const entry of entries) {
    try {
      if (!entry.clientName || !entry.scheduledDate) {
        skipped++;
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
          .select("id, status, scheduled_day, scheduled_time, sales_person")
          .eq("workspace_id", workspaceId)
          .eq("id", entry.sourceLeadId)
          .maybeSingle();
        existingLead = data;
      }

      if (!existingLead) {
        // Try matching by client name + scheduled date
        const { data } = await supabase
          .from("leads")
          .select("id, status, scheduled_day, scheduled_time, sales_person")
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
          .select("id, status, scheduled_day, scheduled_time, sales_person, calendar_sync_status")
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
          synced++;
        } else {
          skipped++;
        }
        continue;
      }

      if (existingLead) {
        // Update existing lead
        const updates: Record<string, unknown> = {
          scheduled_day: entry.scheduledDate,
          calendar_sync_status: "synced",
          calendar_sync_at: new Date().toISOString(),
        };

        if (entry.scheduledTime) {
          updates.scheduled_time = entry.scheduledTime;
        }

        if (entry.assignedRep) {
          updates.sales_person = entry.assignedRep;
        }

        if (entry.address) updates.address = entry.address;
        if (entry.city) updates.city = entry.city;
        if (entry.state) updates.state = normalizeState(entry.state) ?? entry.state;
        if (entry.zip) updates.zip = normalizeZip(entry.zip) ?? entry.zip;
        if (entry.notes) updates.notes = entry.notes;

        // If the lead isn't already scheduled or completed, mark as Scheduled
        if (existingLead.status !== "Completed" && existingLead.status !== "Scheduled") {
          updates.status = "Scheduled";
        }

        await supabase
          .from("leads")
          .update(updates)
          .eq("id", existingLead.id)
          .eq("workspace_id", workspaceId);

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
          lead_source: "SingleOps",
          lead_type: "Residential",
          calendar_sync_status: "synced" as const,
          calendar_sync_at: new Date().toISOString(),
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

  return NextResponse.json({
    synced,
    skipped,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}

function parseFirstName(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 0 ? parts[0] : null;
}

function parseLastName(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : null;
}
