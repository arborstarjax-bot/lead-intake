import "server-only";
import { createAdminClient } from "@/modules/shared/supabase/server";

export type AppSettings = {
  workspace_id: string;
  setup_completed: boolean;
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  /** "HH:MM" in local time. */
  work_start_time: string;
  work_end_time: string;
  /** 0-6 where 0 = Sunday. */
  work_days: number[];
  /** IANA timezone identifier e.g. "America/New_York". */
  timezone: string;
  default_job_minutes: number;
  travel_buffer_minutes: number;
  min_time_between_appointments: number;
  days_until_lost: number;
  days_until_not_sold: number;

  // Tailoring: company identity, salespeople roster, and per-channel
  // message templates. Nullable templates mean "fall back to the built-in
  // default" so the app still sends reasonable copy if nothing is filled.
  company_name: string | null;
  company_phone: string | null;
  company_email: string | null;
  business_type: string | null;
  salespeople: string[];
  salesperson_titles: Record<string, string>;
  default_salesperson: string | null;
  sms_intro_template: string | null;
  sms_confirm_template: string | null;
  sms_enroute_template: string | null;
  email_subject_template: string | null;
  email_body_template: string | null;
  lead_sources: string[];

  created_at: string;
  updated_at: string;
};

export type AppSettingsPatch = Partial<
  Pick<
    AppSettings,
    | "setup_completed"
    | "home_address"
    | "home_city"
    | "home_state"
    | "home_zip"
    | "work_start_time"
    | "work_end_time"
    | "work_days"
    | "timezone"
    | "default_job_minutes"
    | "travel_buffer_minutes"
    | "min_time_between_appointments"
    | "days_until_lost"
    | "days_until_not_sold"
    | "company_name"
    | "company_phone"
    | "company_email"
    | "business_type"
    | "salespeople"
    | "salesperson_titles"
    | "default_salesperson"
    | "sms_intro_template"
    | "sms_confirm_template"
    | "sms_enroute_template"
    | "email_subject_template"
    | "email_body_template"
    | "lead_sources"
  >
>;

export function defaultSettings(workspaceId: string): AppSettings {
  const now = new Date().toISOString();
  return {
    workspace_id: workspaceId,
    setup_completed: false,
    home_address: null,
    home_city: null,
    home_state: null,
    home_zip: null,
    work_start_time: "08:00",
    work_end_time: "17:00",
    work_days: [1, 2, 3, 4, 5, 6],
    timezone: "America/New_York",
    default_job_minutes: 60,
    travel_buffer_minutes: 15,
    min_time_between_appointments: 60,
    days_until_lost: 30,
    days_until_not_sold: 30,
    company_name: null,
    company_phone: null,
    company_email: null,
    business_type: null,
    salespeople: [],
    salesperson_titles: {},
    default_salesperson: null,
    sms_intro_template: null,
    sms_confirm_template: null,
    sms_enroute_template: null,
    email_subject_template: null,
    email_body_template: null,
    lead_sources: [
      "Facebook",
      "Instagram",
      "Google Ads",
      "Website Form",
      "Nextdoor",
      "Thumbtack",
      "Angi",
      "Close AI",
      "Certified Lead Kings",
      "Craigslist",
      "Email",
      "Referral",
      "Direct Mail",
      "Text Message",
      "Other",
    ],
    created_at: now,
    updated_at: now,
  };
}

/**
 * Returns the workspace's settings row. Falls back to sensible defaults if
 * the row hasn't been seeded yet (new workspace bootstrap is supposed to
 * seed it, but we stay defensive).
 */
export async function getSettings(workspaceId: string): Promise<AppSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return defaultSettings(workspaceId);
  const merged = {
    ...defaultSettings(workspaceId),
    ...(data as Partial<AppSettings>),
  } as AppSettings;

  // Ensure new default lead sources appear in existing workspaces that
  // were created before these sources were added.
  const defaults = defaultSettings(workspaceId);
  const storedLower = new Set(merged.lead_sources.map((s) => s.toLowerCase()));
  const missing = defaults.lead_sources.filter(
    (s) => !storedLower.has(s.toLowerCase())
  );
  if (missing.length > 0) {
    const otherIdx = merged.lead_sources.findIndex(
      (s) => s.toLowerCase() === "other"
    );
    if (otherIdx >= 0) {
      merged.lead_sources = [
        ...merged.lead_sources.slice(0, otherIdx),
        ...missing,
        ...merged.lead_sources.slice(otherIdx),
      ];
    } else {
      merged.lead_sources = [...merged.lead_sources, ...missing];
    }
  }

  return merged;
}

export async function updateSettings(
  workspaceId: string,
  patch: AppSettingsPatch
): Promise<AppSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(`Update settings failed: ${error.message}`);
  return {
    ...defaultSettings(workspaceId),
    ...(data as Partial<AppSettings>),
  } as AppSettings;
}

/**
 * Comma-joined home address suitable for Google Maps Distance Matrix calls.
 * Returns null when no home address has been set.
 */
export function homeAddressString(s: AppSettings): string | null {
  const parts = [s.home_address, s.home_city, s.home_state, s.home_zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
