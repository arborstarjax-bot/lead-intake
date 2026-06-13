import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireMembership } from "@/modules/auth/server";
import { getVoiceConfig, upsertVoiceConfig } from "@/modules/voice/server";

export const dynamic = "force-dynamic";

const timeSchema = z
  .string()
  .transform((val) => {
    // Strip any non-ASCII whitespace (iOS inserts \u202f or \u00a0 before AM/PM)
    const cleaned = val.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
    // Normalize 12h AM/PM to 24h (e.g. "5:00 PM" → "17:00", "9:00AM" → "09:00")
    const ampm = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a\.m\.|p\.m\.)$/i);
    if (ampm) {
      let h = parseInt(ampm[1]);
      const m = ampm[2];
      const period = ampm[3].toUpperCase().replace(/\./g, "");
      if (period === "PM" && h < 12) h += 12;
      if (period === "AM" && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:${m}`;
    }
    // Normalize single-digit hour (e.g. "9:00" → "09:00")
    const simple = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (simple) {
      return `${simple[1].padStart(2, "0")}:${simple[2]}`;
    }
    return cleaned;
  })
  .refine(
    (val) => /^([01]\d|2[0-3]):[0-5]\d$/.test(val),
    "time must be HH:MM"
  );

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    agent_name: z.string().trim().min(1).max(80).optional(),
    agent_name_male: z.string().trim().min(1).max(80).nullable().optional(),
    agent_name_female: z.string().trim().min(1).max(80).nullable().optional(),
    company_name: z.string().trim().nullable().optional(),
    greeting_template: z.string().nullable().optional(),
    system_prompt: z.string().nullable().optional(),
    vapi_assistant_id: z.string().trim().nullable().optional(),
    vapi_phone_id: z.string().trim().nullable().optional(),
    voice_provider: z.enum(["elevenlabs", "deepgram", "playht", "vapi"]).optional(),
    voice_id: z.string().trim().nullable().optional(),
    call_window_start: timeSchema.optional(),
    call_window_end: timeSchema.optional(),
    call_days: z.array(z.number().int().min(1).max(7)).optional(),
    timezone: z.string().min(1).optional(),
    max_attempts: z.number().int().min(1).max(10).optional(),
    retry_delay_mins: z.number().int().min(5).max(1440).optional(),
    concurrent_calls: z.number().int().min(1).max(10).optional(),
    auto_call_new_leads: z.boolean().optional(),
    auto_follow_up_no_answer: z.boolean().optional(),
    auto_follow_up_estimates: z.boolean().optional(),
    auto_reengage_dormant: z.boolean().optional(),
    dormant_days_threshold: z.number().int().min(1).max(365).optional(),
    transfer_phone_number: z.string().trim().nullable().optional(),
    transfer_enabled: z.boolean().optional(),
  })
  .strip();

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;
  const config = await getVoiceConfig(auth.workspaceId);
  return NextResponse.json({ config });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let parsed;
  try {
    const json = await req.json();
    parsed = patchSchema.parse(json);
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (parsed.call_window_start && parsed.call_window_end) {
    if (parsed.call_window_start >= parsed.call_window_end) {
      return NextResponse.json(
        { error: "call_window_end must be after call_window_start" },
        { status: 400 }
      );
    }
  }

  try {
    const config = await upsertVoiceConfig(auth.workspaceId, parsed);
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
