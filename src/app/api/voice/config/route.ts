import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireMembership } from "@/modules/auth/server";
import { getVoiceConfig, upsertVoiceConfig } from "@/modules/voice/server";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    agent_name: z.string().trim().min(1).max(80).optional(),
    company_name: z.string().trim().nullable().optional(),
    greeting_template: z.string().nullable().optional(),
    system_prompt: z.string().nullable().optional(),
    vapi_assistant_id: z.string().trim().nullable().optional(),
    vapi_phone_id: z.string().trim().nullable().optional(),
    voice_provider: z.enum(["elevenlabs", "deepgram", "playht", "vapi"]).optional(),
    voice_id: z.string().trim().nullable().optional(),
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
