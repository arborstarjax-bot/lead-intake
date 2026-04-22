export const LEAD_STATUSES = [
  "New",
  "Called / No Response",
  "Scheduled",
  "Completed",
  "Lost",
] as const;

/**
 * A lead is auto-moved from "Called / No Response" to "Lost" once
 * `status_changed_at` is older than this many days.
 */
export const LOST_AFTER_DAYS = 30;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

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

export const LEAD_FLEX_WINDOWS = ["all_day", "am", "pm"] as const;
export type LeadFlexWindow = (typeof LEAD_FLEX_WINDOWS)[number];

export const LEAD_FLEX_WINDOW_LABELS: Record<LeadFlexWindow, string> = {
  all_day: "All Day Flex",
  am: "AM Flex",
  pm: "PM Flex",
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
};

export const LEAD_ACTIVITY_TYPES = [
  "lead_intake",
  "lead_scheduled",
  "lead_completed",
  "customer_called",
  "customer_texted",
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const LEAD_ACTIVITY_LABELS: Record<LeadActivityType, string> = {
  lead_intake: "Lead intake",
  lead_scheduled: "Lead scheduled",
  lead_completed: "Lead completed",
  customer_called: "Customer called",
  customer_texted: "Customer texted",
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  type: LeadActivityType;
  details: Record<string, unknown> | null;
  created_at: string;
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
];
