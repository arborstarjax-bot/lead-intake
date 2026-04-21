import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export type AppSettings = {
  id: number;
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  /** "HH:MM" in local time (America/New_York). */
  work_start_time: string;
  work_end_time: string;
  /** 0-6 where 0 = Sunday. */
  work_days: number[];
  default_job_minutes: number;
  travel_buffer_minutes: number;
  created_at: string;
  updated_at: string;
};

export type AppSettingsPatch = Partial<
  Pick<
    AppSettings,
    | "home_address"
    | "home_city"
    | "home_state"
    | "home_zip"
    | "work_start_time"
    | "work_end_time"
    | "work_days"
    | "default_job_minutes"
    | "travel_buffer_minutes"
  >
>;

export const DEFAULT_SETTINGS: AppSettings = {
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
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/**
 * Returns the singleton settings row. Falls back to DEFAULT_SETTINGS if the
 * table is empty or the migration has not been run yet — this keeps the app
 * usable during the brief window between deploy and SQL apply.
 */
export async function getSettings(): Promise<AppSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  return data as AppSettings;
}

export async function updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .single();
  if (error) throw new Error(`Update settings failed: ${error.message}`);
  return data as AppSettings;
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
