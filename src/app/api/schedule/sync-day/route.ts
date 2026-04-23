import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getAccessToken } from "@/modules/calendar";
import { requireMembership } from "@/modules/auth";
import {
  canSchedule,
  createCalendarEvent,
  isPendingCalendarClaim,
  realCalendarEventId,
  updateCalendarEvent,
} from "@/modules/calendar";
import type { Lead } from "@/modules/leads/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  })
  .strict();

type PerLeadResult = {
  leadId: string;
  label: string;
  status: "already" | "created" | "updated" | "skipped" | "error";
  error?: string;
};

/**
 * POST /api/schedule/sync-day
 *
 * Batch-sync every scheduled stop on a day to Google Calendar. Creates new
 * events for unsynced leads, updates existing events whose day/time drifted,
 * and no-ops for leads already in sync. Replaces what used to be "tap each
 * lead card individually" with one button on the route page.
 */
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const token = await getAccessToken(auth.userId);
  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected", connectUrl: "/api/google/connect" },
      { status: 428 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .eq("scheduled_day", parsed.date)
    .not("scheduled_time", "is", null)
    .neq("status", "Completed")
    .order("scheduled_time", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const leads = (data ?? []) as Lead[];

  const normalizeTime = (t: string | null): string | null => {
    if (!t) return null;
    const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
    return m ? `${m[1]}:${m[2]}` : t;
  };

  // Sync serially so Google sees a tidy request stream and we don't spray
  // partial updates on transient 429. Per-lead failures are captured into
  // results[] rather than aborting the whole batch.
  const results: PerLeadResult[] = [];
  for (const lead of leads) {
    const label =
      lead.client?.trim() ||
      `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
      "Scheduled job";
    if (!canSchedule(lead)) {
      results.push({ leadId: lead.id, label, status: "skipped" });
      continue;
    }
    // Another request is mid-create on this lead's calendar event. Don't
    // race against the single-lead POST — skip for this batch and let
    // the next sync-day sweep pick it up.
    if (isPendingCalendarClaim(lead.calendar_event_id)) {
      results.push({ leadId: lead.id, label, status: "skipped" });
      continue;
    }
    const desiredDay = lead.scheduled_day;
    const desiredTime = normalizeTime(lead.scheduled_time);
    const syncedDay = lead.calendar_scheduled_day;
    const syncedTime = normalizeTime(lead.calendar_scheduled_time);
    const realEventId = realCalendarEventId(lead.calendar_event_id);
    const upToDate =
      realEventId && syncedDay === desiredDay && syncedTime === desiredTime;
    if (upToDate) {
      results.push({ leadId: lead.id, label, status: "already" });
      continue;
    }

    const nextStatus: Lead["status"] =
      lead.status === "Completed" ? "Completed" : "Scheduled";
    const leadForEvent: Lead = { ...lead, status: nextStatus };

    try {
      const event = realEventId
        ? await updateCalendarEvent(token, realEventId, leadForEvent)
        : await createCalendarEvent(token, leadForEvent);
      await supabase
        .from("leads")
        .update({
          calendar_event_id: event.id,
          calendar_scheduled_day: desiredDay,
          calendar_scheduled_time: desiredTime,
          status: nextStatus,
        })
        .eq("id", lead.id)
        .eq("workspace_id", auth.workspaceId);
      results.push({
        leadId: lead.id,
        label,
        status: realEventId ? "updated" : "created",
      });
    } catch (e) {
      results.push({
        leadId: lead.id,
        label,
        status: "error",
        error: (e as Error).message,
      });
    }
  }

  const summary = {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    already: results.filter((r) => r.status === "already").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  return NextResponse.json({ results, summary });
}
