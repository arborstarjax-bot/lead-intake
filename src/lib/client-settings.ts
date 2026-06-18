/**
 * Browser-side mirror of `src/lib/settings.ts`. Same shape, no `server-only`
 * import so it can be used in client components.
 *
 * The canonical source is still the server-rendered row; this file just
 * gives the client a typed view for rendering SMS / email templates and
 * the salespeople chip list.
 */

export type ClientAppSettings = {
  id: number;
  setup_completed: boolean;
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  timezone: string;
  default_job_minutes: number;
  travel_buffer_minutes: number;
  min_time_between_appointments: number;
  days_until_lost: number;
  days_until_not_sold: number;

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
  auto_sync_to_singleops: boolean;
  sync_interval_minutes: number;

  created_at: string;
  updated_at: string;
};

export const DEFAULT_CLIENT_SETTINGS: ClientAppSettings = {
  id: 1,
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
  auto_sync_to_singleops: false,
  sync_interval_minutes: 15,
  lead_sources: [
    "Facebook",
    "Instagram",
    "Google Ads",
    "Website Form",
    "Nextdoor",
    "Thumbtack",
    "Angi",
    "SingleOps",
    "Hubspot",
    "Target Tree",
    "Craigslist",
    "Email",
    "Referral",
    "Direct Mail",
    "Text Message",
    "Other",
  ],
  created_at: "",
  updated_at: "",
};
