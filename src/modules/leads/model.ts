export const LEAD_STATUSES = [
  "New",
  "Called / No Response",
  "Scheduled",
  "Pending",
  "Completed",
  "Lost",
] as const;

/**
 * A lead is auto-moved from "Called / No Response" to "Lost" once
 * `status_changed_at` is older than this many days.
 */
export const LOST_AFTER_DAYS = 30;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Human-friendly labels for each status. Keep the underlying enum
 * value (stored in the DB) unchanged so we don't need a migration,
 * but use these labels everywhere the status is shown to the user.
 * "Called / No Response" renders as "Needs Followup" — the previous
 * label read like a lifecycle step rather than an action the user
 * should take on the lead.
 */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  New: "New",
  "Called / No Response": "Needs Followup",
  Scheduled: "Scheduled",
  Pending: "Pending",
  Completed: "Completed",
  Lost: "Lost",
};

export const LEAD_INTAKE_SOURCES = [
  "web_upload",
  "quick_link",
  "email_ingest",
  "manual",
] as const;
export type LeadIntakeSource = (typeof LEAD_INTAKE_SOURCES)[number];

export const LEAD_INTAKE_STATUSES = [
  "processing",
  "needs_review",
  "ready",
  "failed",
] as const;
export type LeadIntakeStatus = (typeof LEAD_INTAKE_STATUSES)[number];

export const LEAD_SOURCES = [
  "Facebook",
  "Craigslist",
  "Instagram",
  "Text Message",
  "Google Ads",
  "Website Form",
  "Nextdoor",
  "Thumbtack",
  "Angi",
  "Email",
  "Referral",
  "Direct Mail",
  "Other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/* ── Lead type ───────────────────────────────────────────────── */

export const LEAD_TYPES = ["Residential", "Commercial", "Government"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

/* ── Estimate outcome tracking ────────────────────────────────── */

export const ESTIMATE_OUTCOMES = [
  "Sold",
  "Not Sold",
  "Needs Follow-Up",
  "No Proposal Sent",
  "Pending",
] as const;
export type EstimateOutcome = (typeof ESTIMATE_OUTCOMES)[number];

export const NO_PROPOSAL_REASONS = [
  "Not Within Scope",
  "Did Not Meet Minimum",
  "Other",
] as const;
export type NoProposalReason = (typeof NO_PROPOSAL_REASONS)[number];

export const FOLLOW_UP_RESULTS = [
  "Called — No Answer",
  "Left Voicemail",
  "Spoke With Customer",
  "Requested Callback",
  "Awaiting Decision Maker",
  "Price Shopping",
  "Could Not Connect",
  "Reschedule Needed",
  "Proposal Revision Requested",
  "Other",
] as const;
export type FollowUpResult = (typeof FOLLOW_UP_RESULTS)[number];

export const OUTCOME_BADGES = [
  "Sold",
  "Not Sold",
  "Lost",
  "Needs Follow-Up",
  "No Proposal Sent",
  "Not Within Scope",
  "Did Not Meet Minimum",
  "Proposal Revision Requested",
  "Pending",
  "Requested Callback",
] as const;
export type OutcomeBadge = (typeof OUTCOME_BADGES)[number];

export const LEAD_FLEX_WINDOWS = ["all_day", "am", "pm"] as const;
export type LeadFlexWindow = (typeof LEAD_FLEX_WINDOWS)[number];

export const LEAD_FLEX_WINDOW_LABELS: Record<LeadFlexWindow, string> = {
  all_day: "All Day Flex",
  am: "AM Flex",
  pm: "PM Flex",
};

/**
 * Display label shown in place of a scheduled time when a lead has a
 * flex window set (e.g. on the lead card, calendar week chip). Kept
 * distinct from `LEAD_FLEX_WINDOW_LABELS` (which reads as a window
 * name, like "AM Flex") so the time slot literally reads as a time
 * substitute: "Flex — All Day", "Flex — AM", "Flex — PM".
 */
export const LEAD_FLEX_WINDOW_DISPLAY: Record<LeadFlexWindow, string> = {
  all_day: "Flex — All Day",
  am: "Flex — AM",
  pm: "Flex — PM",
};

export type Lead = {
  id: string;
  created_at: string;
  updated_at: string;
  date: string | null;
  first_name: string | null;
  last_name: string | null;
  client: string | null;
  phone_number: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: LeadStatus;
  sales_person: string | null;
  scheduled_day: string | null;
  scheduled_time: string | null;
  flex_window: LeadFlexWindow | null;
  notes: string | null;
  screenshot_url: string | null;
  screenshot_path: string | null;
  extraction_confidence: Record<string, number> | null;
  calendar_event_id: string | null;
  calendar_scheduled_day: string | null;
  calendar_scheduled_time: string | null;
  intake_source: LeadIntakeSource;
  intake_status: LeadIntakeStatus;
  lead_source: string | null;
  lead_type: LeadType | null;
  estimate_outcome: EstimateOutcome | null;
  no_proposal_reason: NoProposalReason | null;
  no_proposal_notes: string | null;
  follow_up_result: FollowUpResult | OutcomeReason | "Expired" | null;
  follow_up_notes: string | null;
  outcome_badge: OutcomeBadge | null;
  ai_call_count: number | null;
  ai_last_call_at: string | null;
  ai_last_call_status: string | null;
  ai_notes: string | null;
  ai_do_not_call: boolean | null;
};

/* ── Outcome reason tracking (Lost / Not Sold) ───────────────── */

export const OUTCOME_REASONS = [
  "No Response",
  "Not Interested",
  "Budget Issues",
  "Went With Competitor",
  "Bad Lead / Wrong Info",
  "Incorrect Contact Info",
  "Out of Service Area",
  "Did Not Meet Minimum",
  "Not In Scope",
  "Other",
] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

export type OutcomeReasonSubFilter = "All" | OutcomeReason | "Expired";

export const LEAD_ACTIVITY_TYPES = [
  "lead_intake",
  "lead_scheduled",
  "lead_completed",
  "customer_called",
  "customer_texted",
  "ai_called",
  "status_changed",
  "follow_up_set",
  "proposal_sent",
  "marked_sold",
  "marked_not_sold",
  "marked_lost",
  "marked_pending",
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const LEAD_ACTIVITY_LABELS: Record<LeadActivityType, string> = {
  lead_intake: "Lead intake",
  lead_scheduled: "Lead scheduled",
  lead_completed: "Lead completed",
  customer_called: "Customer called",
  customer_texted: "Customer texted",
  ai_called: "AI called",
  status_changed: "Status changed",
  follow_up_set: "Follow-up updated",
  proposal_sent: "Proposal sent",
  marked_sold: "Marked Sold",
  marked_not_sold: "Marked Not Sold",
  marked_lost: "Marked Lost",
  marked_pending: "Moved to Pending",
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  type: LeadActivityType;
  details: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Body shape accepted by PATCH /api/leads/{id}. Supersets `Partial<Lead>`
 * with a couple of server-side merge/override knobs the UI uses:
 *
 *   • `extraction_confidence_merge` — partial `{field: 0..1 | null}` map
 *     that the server merges into the row's existing
 *     `extraction_confidence` jsonb. Numbers set/replace that field's
 *     score (used by the address-intelligence autofill flow to stamp
 *     confidence on AI-inferred fields). `null` deletes that field's
 *     entry — used when the user types over an AI-inferred value so
 *     the "AI ##%" chip disappears.
 *   • `expected_updated_at` — optimistic-concurrency guard. The server
 *     rejects the write with 409 `stale_write` if the row's
 *     `updated_at` advanced since the caller read it.
 */
export type LeadPatch = Partial<Lead> & {
  extraction_confidence_merge?: Record<string, number | null>;
  expected_updated_at?: string;
};

export const EDITABLE_COLUMNS: (keyof Lead)[] = [
  "date",
  "first_name",
  "last_name",
  "client",
  "phone_number",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "status",
  "sales_person",
  "scheduled_day",
  "scheduled_time",
  "flex_window",
  "notes",
  "lead_source",
  "lead_type",
  "estimate_outcome",
  "no_proposal_reason",
  "no_proposal_notes",
  "follow_up_result",
  "follow_up_notes",
  "outcome_badge",
];
