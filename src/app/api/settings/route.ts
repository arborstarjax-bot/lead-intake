import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, updateSettings, type AppSettingsPatch } from "@/lib/settings";
import { requireMembership, requireAdmin } from "@/modules/auth/server";

export const dynamic = "force-dynamic";

const timeSchema = z
  .string()
  .transform((val) => {
    // Strip non-ASCII whitespace (iOS inserts \u202f or \u00a0 before AM/PM)
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
    // Normalize HH:MM or HH:MM:SS (strip seconds, pad hour)
    const simple = cleaned.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (simple) return `${simple[1].padStart(2, "0")}:${simple[2]}`;
    return cleaned;
  })
  .refine(
    (val) => /^([01]\d|2[0-3]):[0-5]\d$/.test(val),
    "time must be HH:MM"
  );

const bodySchema = z
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

    // Tailoring fields (see 2026-04-24 migration).
    company_name: z.string().trim().nullable().optional(),
    company_phone: z.string().trim().nullable().optional(),
    company_email: z.string().trim().nullable().optional(),
    business_type: z.string().trim().max(100).nullable().optional(),
    // Salespeople is a small roster; cap it so one typo can't blow up the UI.
    salespeople: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .optional(),
    salesperson_titles: z.record(z.string().max(80)).optional(),
    default_salesperson: z.string().trim().max(80).nullable().optional(),
    sms_intro_template: z.string().nullable().optional(),
    sms_confirm_template: z.string().nullable().optional(),
    sms_enroute_template: z.string().nullable().optional(),
    email_subject_template: z.string().nullable().optional(),
    email_body_template: z.string().nullable().optional(),
  })
  .strict();

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const settings = await getSettings(auth.workspaceId);
  return NextResponse.json({ settings, role: auth.role });
}

export async function PUT(req: Request) {
  // Only admins can persist settings. Regular members still read via GET.
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let parsed;
  try {
    const json = await req.json();
    parsed = bodySchema.parse(json);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // work_end_time must be strictly after work_start_time when both present.
  if (parsed.work_start_time && parsed.work_end_time) {
    if (parsed.work_start_time >= parsed.work_end_time) {
      return NextResponse.json(
        { error: "work_end_time must be after work_start_time" },
        { status: 400 }
      );
    }
  }

  const patch: AppSettingsPatch = {};
  for (const [k, v] of Object.entries(parsed)) {
    // Collapse empty strings to null for nullable text columns, but leave
    // string[] (salespeople) and templates (where "" means "use default")
    // as-is. Template empties are mapped to null so the resolver falls
    // back to DEFAULT_* copy.
    if (v === "" || (typeof v === "string" && v.trim() === "" && k !== "salespeople")) {
      (patch as Record<string, unknown>)[k] = null;
    } else {
      (patch as Record<string, unknown>)[k] = v;
    }
  }

  try {
    const settings = await updateSettings(auth.workspaceId, patch);
    return NextResponse.json({ settings, role: auth.role });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
