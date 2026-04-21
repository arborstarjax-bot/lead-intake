import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/lib/google/oauth";
import {
  createCalendarEvent,
  updateCalendarEvent,
  canSchedule,
} from "@/lib/google/calendar";
import type { Lead } from "@/lib/types";

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

  const token = await getAccessToken();
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
    .eq("scheduled_day", parsed.date)
    .not("scheduled_time", "is", null)
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
    const desiredDay = lead.scheduled_day;
    const desiredTime = normalizeTime(lead.scheduled_time);
    const syncedDay = lead.calendar_scheduled_day;
    const syncedTime = normalizeTime(lead.calendar_scheduled_time);
    const upToDate =
      lead.calendar_event_id && syncedDay === desiredDay && syncedTime === desiredTime;
    if (upToDate) {
      results.push({ leadId: lead.id, label, status: "already" });
      continue;
    }

    const nextStatus: Lead["status"] =
      lead.status === "Completed" ? "Completed" : "Scheduled";
    const leadForEvent: Lead = { ...lead, status: nextStatus };

    try {
      const event = lead.calendar_event_id
        ? await updateCalendarEvent(token, lead.calendar_event_id, leadForEvent)
        : await createCalendarEvent(token, leadForEvent);
      await supabase
        .from("leads")
        .update({
          calendar_event_id: event.id,
          calendar_scheduled_day: desiredDay,
          calendar_scheduled_time: desiredTime,
          status: nextStatus,
        })
        .eq("id", lead.id);
      results.push({
        leadId: lead.id,
        label,
        status: lead.calendar_event_id ? "updated" : "created",
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
