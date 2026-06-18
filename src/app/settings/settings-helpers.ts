import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientAppSettings,
} from "@/lib/client-settings";

export const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export type Patch = Partial<ClientAppSettings>;

/** Normalize any time string (AM/PM, narrow-space, etc.) to HH:MM 24h. */
export function normalizeTime(val: string): string {
  const cleaned = val.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  const ampm = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2];
    const period = ampm[3].toUpperCase().replace(/\./g, "");
    if (period === "PM" && h < 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${m}`;
  }
  const simple = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (simple) return `${simple[1].padStart(2, "0")}:${simple[2]}`;
  return cleaned;
}

/**
 * Shallow diff between two settings snapshots. Only fields that the
 * UI renders as editable are compared; the server is authoritative
 * for the rest. Arrays (work_days, salespeople) are compared via
 * JSON.stringify — both are short and primitives-only.
 */
export const EDITABLE_KEYS = [
  "company_name",
  "company_phone",
  "company_email",
  "business_type",
  "salespeople",
  "salesperson_titles",
  "default_salesperson",
  "sms_intro_template",
  "sms_confirm_template",
  "sms_enroute_template",
  "email_subject_template",
  "email_body_template",
  "home_address",
  "home_city",
  "home_state",
  "home_zip",
  "work_start_time",
  "work_end_time",
  "work_days",
  "timezone",
  "default_job_minutes",
  "travel_buffer_minutes",
  "min_time_between_appointments",
  "days_until_lost",
  "days_until_not_sold",
  "lead_sources",
  "auto_sync_to_singleops",
] as const satisfies ReadonlyArray<keyof ClientAppSettings>;

/**
 * `work_start_time` / `work_end_time` round-trip through Postgres as
 * `HH:MM:SS` but `<input type="time">` onChange only yields `HH:MM`.
 * Trim both sides to minutes so changing a time and changing it back
 * doesn't leave the page stuck in a phantom-dirty state.
 */
export function timeEq(a: unknown, b: unknown): boolean {
  const na = normalizeTime(String(a ?? "")).slice(0, 5);
  const nb = normalizeTime(String(b ?? "")).slice(0, 5);
  return na === nb;
}

export function diffSettings(next: ClientAppSettings, prev: ClientAppSettings): Patch {
  const patch: Patch = {};
  for (const key of EDITABLE_KEYS) {
    const a = next[key];
    const b = prev[key];
    let same: boolean;
    if (
      (Array.isArray(a) && Array.isArray(b)) ||
      (typeof a === "object" && a !== null && typeof b === "object" && b !== null)
    ) {
      same = JSON.stringify(a) === JSON.stringify(b);
    } else if (key === "work_start_time" || key === "work_end_time") {
      same = timeEq(a, b);
    } else if (
      (typeof a === "string" || a === null) &&
      (typeof b === "string" || b === null)
    ) {
      // Nullable text columns: the API collapses "" to null before
      // saving, so after a successful save `savedRef` holds null while
      // the input still holds "". Normalize both sides so cleared
      // fields don't get stuck showing Unsaved changes forever.
      same = (a ?? "") === (b ?? "");
    } else {
      same = a === b;
    }
    if (!same) {
      // Normalize time values before including in patch
      const value = (key === "work_start_time" || key === "work_end_time") && typeof a === "string"
        ? normalizeTime(a)
        : a;
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

export const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";

export const textareaCls =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-y";

export { DEFAULT_CLIENT_SETTINGS };
