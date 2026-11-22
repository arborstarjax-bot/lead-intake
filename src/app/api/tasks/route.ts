import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { getSettings } from "@/lib/settings";
import { nextOccurrenceDate, TASK_EDITABLE_COLUMNS } from "@/modules/tasks/model";
import { emitWebhookEvent, taskToContract } from "@/modules/api/v1";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const status = req.nextUrl.searchParams.get("status");

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .order("start_at", { ascending: true });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Reject non-finite (Postgres accepts 'infinity'/'-infinity' as timestamps)
// and wildly out-of-range dates — they make the recurrence loop below
// either never terminate or generate unbounded rows.
const saneTimestamp = z
  .string()
  .refine((v) => {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return false;
    const now = Date.now();
    return t > now - 366 * DAY_MS && t < now + 5 * 366 * DAY_MS;
  }, "must be a real timestamp within a sane range");

const createTaskSchema = z
  .object({
    name: z.string().min(1),
    start_at: saneTimestamp,
    end_at: saneTimestamp,
    recurrence_end_date: saneTimestamp.nullish(),
    recurrence_end_count: z.number().int().positive().max(500).nullish(),
  })
  .passthrough()
  .refine((v) => Date.parse(v.end_at) >= Date.parse(v.start_at), {
    message: "end_at must be at or after start_at",
  });

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const payload = await req.json().catch(() => ({}));
  const parsed = createTaskSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid task payload" },
      { status: 400 },
    );
  }

  // Explicit allowlist — never spread the raw body into the insert.
  const safe: Record<string, unknown> = {};
  for (const key of TASK_EDITABLE_COLUMNS) {
    if (key in parsed.data) safe[key] = parsed.data[key];
  }
  if (typeof parsed.data.extraction_source === "string") {
    safe.extraction_source = parsed.data.extraction_source;
  }

  // Default assignee to workspace default salesperson if not set
  if (!safe.assignee) {
    try {
      const settings = await getSettings(auth.workspaceId);
      if (settings.default_salesperson) {
        safe.assignee = settings.default_salesperson;
      }
    } catch {
      // Non-blocking
    }
  }

  // Auto-generate task name: "Assignee - Task" if not provided with that pattern
  if (safe.assignee && !(safe.name as string).includes(" - ")) {
    safe.name = `${safe.assignee} - ${safe.name}`;
  }

  const row = {
    ...safe,
    workspace_id: auth.workspaceId,
    created_by: auth.userId,
    status: safe.status || "Scheduled",
    extraction_source: safe.extraction_source || "manual",
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-generate future occurrences for recurring tasks (4-week lookahead)
  if (data && safe.recurrence_rule) {
    void generateRecurringOccurrences(
      supabase,
      data,
      safe.recurrence_rule as string,
      auth.workspaceId,
      auth.userId,
    ).catch(() => {});
  }

  void emitWebhookEvent(auth.workspaceId, "task.created", taskToContract(data));

  return NextResponse.json({ task: data });
}

/**
 * Generate future occurrences for a recurring task up to 4 weeks ahead.
 * Each occurrence is a separate task row linked to the parent via parent_task_id.
 */
async function generateRecurringOccurrences(
  supabase: ReturnType<typeof createAdminClient>,
  parent: Record<string, unknown>,
  rule: string,
  workspaceId: string,
  userId: string,
) {
  const LOOKAHEAD_DAYS = 28; // 4 weeks
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + LOOKAHEAD_DAYS);

  const startAt = new Date(parent.start_at as string);
  const endAt = new Date(parent.end_at as string);
  const durationMs = endAt.getTime() - startAt.getTime();

  const MAX_OCCURRENCES = 60; // hard cap regardless of rule/end bounds

  const rows: Record<string, unknown>[] = [];
  let cursor = startAt;
  let idx = 1;
  const endDate = parent.recurrence_end_date
    ? new Date(parent.recurrence_end_date as string)
    : null;
  const endCount = (parent.recurrence_end_count as number) ?? null;

  while (true) {
    const next = nextOccurrenceDate(cursor, rule);
    if (!next || next > cutoff) break;
    if (endDate && next > endDate) break;
    if (endCount && idx >= endCount) break;
    if (rows.length >= MAX_OCCURRENCES) break;
    idx++;

    rows.push({
      workspace_id: workspaceId,
      created_by: userId,
      name: parent.name,
      notes: parent.notes,
      status: "Scheduled",
      start_at: next.toISOString(),
      end_at: new Date(next.getTime() + durationMs).toISOString(),
      address: parent.address,
      city: parent.city,
      state: parent.state,
      zip: parent.zip,
      assignee: parent.assignee,
      extraction_source: "manual",
      recurrence_rule: rule,
      parent_task_id: parent.id,
      occurrence_index: idx,
    });

    cursor = next;
  }

  if (rows.length > 0) {
    // Also mark the parent as occurrence_index=1
    await supabase
      .from("tasks")
      .update({ occurrence_index: 1 })
      .eq("id", parent.id as string);

    await supabase.from("tasks").insert(rows);
  }
}
