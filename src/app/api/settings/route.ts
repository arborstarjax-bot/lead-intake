import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, updateSettings, type AppSettingsPatch } from "@/lib/settings";

export const dynamic = "force-dynamic";

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM");

const bodySchema = z
  .object({
    home_address: z.string().trim().nullable().optional(),
    home_city: z.string().trim().nullable().optional(),
    home_state: z.string().trim().nullable().optional(),
    home_zip: z.string().trim().nullable().optional(),
    work_start_time: timeSchema.optional(),
    work_end_time: timeSchema.optional(),
    work_days: z.array(z.number().int().min(0).max(6)).optional(),
    default_job_minutes: z.number().int().min(5).max(600).optional(),
    travel_buffer_minutes: z.number().int().min(0).max(120).optional(),

    // Tailoring fields (see 2026-04-24 migration).
    company_name: z.string().trim().nullable().optional(),
    company_phone: z.string().trim().nullable().optional(),
    company_email: z.string().trim().nullable().optional(),
    // Salespeople is a small roster; cap it so one typo can't blow up the UI.
    salespeople: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .optional(),
    default_salesperson: z.string().trim().max(80).nullable().optional(),
    sms_intro_template: z.string().nullable().optional(),
    sms_confirm_template: z.string().nullable().optional(),
    email_subject_template: z.string().nullable().optional(),
    email_body_template: z.string().nullable().optional(),
  })
  .strict();

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
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
    const settings = await updateSettings(patch);
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
