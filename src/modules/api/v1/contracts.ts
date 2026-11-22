import { z } from "zod";
import { toCamel } from "./http";

/**
 * Contract schemas for /api/v1. These are the ONLY shapes integrators
 * see — snake_case DB rows are mapped through `toCamel` after stripping
 * internal columns, so renames of internals can't leak.
 *
 * Vocabulary is generic field-service (contact/estimate/assignee) so a
 * Jobber / ServiceTitan / HubSpot / Zapier connector maps fields without
 * learning app jargon.
 */

// ── Leads ──────────────────────────────────────────────────────────────

/** Columns we expose publicly, mapped to contract field names. */
export const LEAD_CONTRACT_SELECT = [
  "id", "created_at", "updated_at",
  "first_name", "last_name", "client",
  "phone_number", "email",
  "address", "city", "state", "zip",
  "status", "lead_source", "lead_type", "job_type", "sales_person",
  "scheduled_day", "scheduled_time", "flex_window",
  "estimate_outcome", "outcome_badge", "follow_up_result",
  "no_proposal_reason", "notes",
].join(",");

export const leadCreateSchema = z.object({
  firstName: z.string().trim().max(80).nullish(),
  lastName: z.string().trim().max(80).nullish(),
  client: z.string().trim().max(160).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().max(160).nullish(),
  address: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(50).nullish(),
  zip: z.string().trim().max(20).nullish(),
  source: z.string().trim().max(80).nullish(),
  type: z.enum(["Residential", "Commercial", "Government"]).nullish(),
  jobType: z.string().trim().max(80).nullish(),
  status: z.string().trim().max(40).nullish(),
  assignee: z.string().trim().max(80).nullish(),
  scheduledAt: z.string().datetime().nullish(),
  notes: z.string().max(5000).nullish(),
}).strict();
export type LeadCreate = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = leadCreateSchema.partial().extend({
  estimateOutcome: z.string().trim().max(60).nullish(),
  followUpResult: z.string().trim().max(80).nullish(),
});

/** DB row → contract shape. */
export function leadToContract(row: Record<string, unknown>) {
  const r = toCamel(row) as Record<string, unknown>;
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    contact: {
      firstName: r.firstName,
      lastName: r.lastName,
      name: r.client,
      phone: r.phoneNumber,
      email: r.email,
      address: {
        line1: r.address,
        city: r.city,
        state: r.state,
        zip: r.zip,
      },
    },
    source: r.leadSource,
    type: r.leadType,
    jobType: r.jobType,
    status: r.status,
    assignee: r.salesPerson,
    estimate: {
      scheduledDay: r.scheduledDay,
      scheduledTime: r.scheduledTime,
      flexWindow: r.flexWindow,
      outcome: r.estimateOutcome,
      badge: r.outcomeBadge,
      followUpResult: r.followUpResult,
      noEstimateReason: r.noProposalReason,
    },
    notes: r.notes,
  };
}

/** Contract write payload → DB columns. */
export function leadFromContract(p: LeadCreate | z.infer<typeof leadUpdateSchema>) {
  const row: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) row[k] = v; };
  set("first_name", p.firstName);
  set("last_name", p.lastName);
  set("client", p.client);
  set("phone_number", p.phone);
  set("email", p.email);
  set("address", p.address);
  set("city", p.city);
  set("state", p.state);
  set("zip", p.zip);
  set("lead_source", p.source);
  set("lead_type", p.type);
  set("job_type", p.jobType);
  set("status", p.status);
  set("sales_person", p.assignee);
  set("notes", p.notes);
  if (p.scheduledAt) {
    const d = new Date(p.scheduledAt);
    row.scheduled_day = d.toISOString().slice(0, 10);
    row.scheduled_time = d.toTimeString().slice(0, 5);
  }
  const u = p as z.infer<typeof leadUpdateSchema>;
  set("estimate_outcome", u.estimateOutcome);
  set("follow_up_result", u.followUpResult);
  return row;
}

// ── Tasks ──────────────────────────────────────────────────────────────

export const TASK_CONTRACT_SELECT = [
  "id", "created_at", "updated_at",
  "name", "notes", "status",
  "start_at", "end_at", "recurrence_rule",
  "address", "city", "state", "zip",
  "assignee",
].join(",");

export const taskCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).nullish(),
  status: z.enum(["Scheduled", "Completed", "Rescheduled", "Cancelled"]).nullish(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullish(),
  recurrence: z.string().trim().max(40).nullish(),
  address: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(50).nullish(),
  zip: z.string().trim().max(20).nullish(),
  assignee: z.string().trim().max(80).nullish(),
}).strict();
export const taskUpdateSchema = taskCreateSchema.partial();

export function taskToContract(row: Record<string, unknown>) {
  const r = toCamel(row) as Record<string, unknown>;
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    name: r.name,
    notes: r.notes,
    status: r.status,
    window: { startAt: r.startAt, endAt: r.endAt, recurrence: r.recurrenceRule },
    address: { line1: r.address, city: r.city, state: r.state, zip: r.zip },
    assignee: r.assignee,
  };
}

export function taskFromContract(p: Partial<z.infer<typeof taskCreateSchema>>) {
  const row: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) row[k] = v; };
  set("name", p.name);
  set("notes", p.notes);
  set("status", p.status);
  set("start_at", p.startAt);
  set("end_at", p.endAt ?? p.startAt);
  set("recurrence_rule", p.recurrence || null);
  set("address", p.address);
  set("city", p.city);
  set("state", p.state);
  set("zip", p.zip);
  set("assignee", p.assignee);
  return row;
}

// ── Webhooks ───────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.sold",
  "lead.lost",
  "task.created",
  "task.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookSubSchema = z.object({
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://"), "must be an https URL"),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
}).strict();
