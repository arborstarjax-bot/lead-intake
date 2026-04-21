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
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  default_job_minutes: number;
  travel_buffer_minutes: number;

  company_name: string | null;
  company_phone: string | null;
  company_email: string | null;
  salespeople: string[];
  sms_intro_template: string | null;
  sms_confirm_template: string | null;
  email_subject_template: string | null;
  email_body_template: string | null;

  created_at: string;
  updated_at: string;
};

export const DEFAULT_CLIENT_SETTINGS: ClientAppSettings = {
  id: 1,
  home_address: null,
  home_city: null,
  home_state: null,
  home_zip: null,
  work_start_time: "08:00",
  work_end_time: "17:00",
  work_days: [1, 2, 3, 4, 5, 6],
  default_job_minutes: 60,
  travel_buffer_minutes: 15,
  company_name: null,
  company_phone: null,
  company_email: null,
  salespeople: [],
  sms_intro_template: null,
  sms_confirm_template: null,
  email_subject_template: null,
  email_body_template: null,
  created_at: "",
  updated_at: "",
};
