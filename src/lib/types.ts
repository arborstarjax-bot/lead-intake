export const LEAD_STATUSES = [
  "New",
  "Called / No Response",
  "Scheduled",
  "Completed",
] as const;
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
  notes: string | null;
  screenshot_url: string | null;
  screenshot_path: string | null;
  extraction_confidence: Record<string, number> | null;
  calendar_event_id: string | null;
  intake_source: LeadIntakeSource;
  intake_status: LeadIntakeStatus;
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
  "notes",
];
