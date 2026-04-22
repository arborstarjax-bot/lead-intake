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
  "salespeople",
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
  "default_job_minutes",
  "travel_buffer_minutes",
] as const satisfies ReadonlyArray<keyof ClientAppSettings>;

/**
 * `work_start_time` / `work_end_time` round-trip through Postgres as
 * `HH:MM:SS` but `<input type="time">` onChange only yields `HH:MM`.
 * Trim both sides to minutes so changing a time and changing it back
 * doesn't leave the page stuck in a phantom-dirty state.
 */
export function timeEq(a: unknown, b: unknown): boolean {
  return String(a ?? "").slice(0, 5) === String(b ?? "").slice(0, 5);
}

export function diffSettings(next: ClientAppSettings, prev: ClientAppSettings): Patch {
  const patch: Patch = {};
  for (const key of EDITABLE_KEYS) {
    const a = next[key];
    const b = prev[key];
    let same: boolean;
    if (Array.isArray(a) && Array.isArray(b)) {
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
      // Assignment goes through `unknown` so TS doesn't infer each
      // field's individual union type for the merged patch.
      (patch as Record<string, unknown>)[key] = a;
    }
  }
  return patch;
}

export const inputCls =
  "w-full h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]";

export const textareaCls =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-y";

export { DEFAULT_CLIENT_SETTINGS };
