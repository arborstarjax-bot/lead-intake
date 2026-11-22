import "server-only";
import { z } from "zod";
import { updateSettings, type AppSettings, type AppSettingsPatch } from "@/lib/settings";

/**
 * Shared settings-update handler. Both PUT /api/settings (session) and
 * PATCH /api/v1/settings (session or Bearer key) call applySettingsPatch.
 */

const timeSchema = z
  .string()
  .transform((val) => {
    // Strip non-ASCII whitespace (iOS inserts   or   before AM/PM)
    const cleaned = val.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
    // Normalize 12h AM/PM → 24h (e.g. "5:00 PM" → "17:00", "9:00 AM" → "09:00")
    const ampm = cleaned.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)$/i);
    if (ampm) {
      let h = parseInt(ampm[1]);
      const m = ampm[2];
      const period = ampm[3].toUpperCase().replace(/\./g, "");
      if (period === "PM" && h < 12) h += 12;
      if (period === "AM" && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:${m}`;
    }
    const simple = cleaned.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (simple) return `${simple[1].padStart(2, "0")}:${simple[2]}`;
    return cleaned;
  })
  .refine((val) => /^([01]\d|2[0-3]):[0-5]\d$/.test(val), "time must be HH:MM");

export const settingsPatchSchema = z
  .object({
    setup_completed: z.boolean().optional(),
    home_address: z.string().trim().nullable().optional(),
    home_city: z.string().trim().nullable().optional(),
    home_state: z.string().trim().nullable().optional(),
    home_zip: z.string().trim().nullable().optional(),
    work_start_time: timeSchema.optional(),
    work_end_time: timeSchema.optional(),
    work_days: z.array(z.number().int().min(0).max(6)).optional(),
    timezone: z.string().min(1).max(50).optional(),
    default_job_minutes: z.number().int().min(5).max(600).optional(),
    travel_buffer_minutes: z.number().int().min(0).max(120).optional(),
    min_time_between_appointments: z.number().int().min(0).max(480).optional(),
    days_until_lost: z.number().int().min(1).max(365).optional(),
    days_until_not_sold: z.number().int().min(1).max(365).optional(),

    company_name: z.string().trim().nullable().optional(),
    company_phone: z.string().trim().nullable().optional(),
    company_email: z.string().trim().nullable().optional(),
    business_type: z.string().trim().max(100).nullable().optional(),
    salespeople: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    salesperson_titles: z.record(z.string().max(80)).optional(),
    default_salesperson: z.string().trim().max(80).nullable().optional(),
    sms_intro_template: z.string().nullable().optional(),
    sms_confirm_template: z.string().nullable().optional(),
    sms_enroute_template: z.string().nullable().optional(),
    email_subject_template: z.string().nullable().optional(),
    email_body_template: z.string().nullable().optional(),
    lead_sources: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    job_types: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  })
  .strict();
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;

export type HandlerResult = { status: number; body: Record<string, unknown> };

/**
 * Applies a validated settings patch with the role gate:
 * non-admins may only change `lead_sources`.
 */
export async function applySettingsPatch(
  workspaceId: string,
  role: "admin" | "user",
  parsed: SettingsPatchInput
): Promise<{ status: number; body: Record<string, unknown>; settings?: AppSettings }> {
  if (role !== "admin") {
    const nonAdminAllowed: (keyof SettingsPatchInput)[] = ["lead_sources", "job_types"];
    for (const key of Object.keys(parsed) as (keyof SettingsPatchInput)[]) {
      if (!nonAdminAllowed.includes(key)) {
        return { status: 403, body: { error: "Only admins can change this setting" } };
      }
    }
  }

  if (parsed.work_start_time && parsed.work_end_time && parsed.work_start_time >= parsed.work_end_time) {
    return { status: 400, body: { error: "work_end_time must be after work_start_time" } };
  }

  const patch: AppSettingsPatch = {};
  for (const [k, v] of Object.entries(parsed)) {
    // Collapse empty strings to null for nullable text columns; leave
    // string[] (salespeople) and "" templates mapped to null so the
    // resolver falls back to DEFAULT_* copy.
    if (v === "" || (typeof v === "string" && v.trim() === "" && k !== "salespeople")) {
      (patch as Record<string, unknown>)[k] = null;
    } else {
      (patch as Record<string, unknown>)[k] = v;
    }
  }

  try {
    const settings = await updateSettings(workspaceId, patch);
    return { status: 200, body: { settings: settings as unknown as Record<string, unknown>, role }, settings };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}
