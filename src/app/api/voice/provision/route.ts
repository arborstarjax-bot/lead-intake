import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/modules/auth/server";
import { getSettings } from "@/lib/settings";
import {
  getVoiceConfig,
  upsertVoiceConfig,
  createVapiAssistant,
  listVapiPhoneNumbers,
  deleteVapiAssistant,
} from "@/modules/voice/server";

export const runtime = "nodejs";

const provisionSchema = z.object({
  /** Service category e.g. "tree service", "plumbing", "HVAC", "landscaping" */
  service_type: z.string().trim().min(1).max(100).optional(),
  /** What they schedule e.g. "free estimate", "consultation", "inspection" */
  appointment_type: z.string().trim().min(1).max(100).optional(),
  /** Who comes out e.g. "our arborist", "a technician", "our team" */
  technician_title: z.string().trim().min(1).max(100).optional(),
  /** Which Vapi phone number ID to use (from the available list) */
  phone_number_id: z.string().trim().min(1).optional(),
});

/**
 * POST /api/voice/provision
 * Auto-provisions a Vapi assistant for the workspace.
 * Requires admin role. Creates the assistant and saves config.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let parsed;
  try {
    const json = await req.json();
    parsed = provisionSchema.parse(json);
  } catch (e) {
    const msg = e instanceof z.ZodError
      ? e.issues.map((i) => i.message).join("; ")
      : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Check if already provisioned
  const existingConfig = await getVoiceConfig(auth.workspaceId);
  if (existingConfig.vapi_assistant_id) {
    return NextResponse.json(
      { error: "AI assistant already provisioned. Disable first to re-provision." },
      { status: 409 }
    );
  }

  // Load workspace settings for company name
  const settings = await getSettings(auth.workspaceId);
  if (!settings.company_name) {
    return NextResponse.json(
      { error: "Please set your company name in workspace settings first." },
      { status: 422 }
    );
  }

  // Determine webhook URL from the request origin
  const origin = req.headers.get("origin") || req.headers.get("referer");
  const baseUrl = origin
    ? new URL(origin).origin
    : `https://${req.headers.get("host")}`;
  const webhookUrl = `${baseUrl}/api/voice/webhook`;

  // Create the Vapi assistant
  let result;
  try {
    result = await createVapiAssistant({
      assistantName: `${settings.company_name} AI`,
      webhookUrl,
      templateVars: {
        serviceType: parsed.service_type ?? "tree service",
        appointmentType: parsed.appointment_type ?? "free estimate",
        technicianTitle: parsed.technician_title ?? "our arborist",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to create AI assistant: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Save the assistant ID and enable voice config
  try {
    await upsertVoiceConfig(auth.workspaceId, {
      enabled: true,
      vapi_assistant_id: result.assistantId,
      ...(parsed.phone_number_id && { vapi_phone_id: parsed.phone_number_id }),
      company_name: settings.company_name,
      agent_name: existingConfig.agent_name || "AI Assistant",
    });
  } catch (e) {
    // Rollback: delete the assistant we just created
    await deleteVapiAssistant(result.assistantId).catch(() => {});
    return NextResponse.json(
      { error: `Failed to save config: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    assistant_id: result.assistantId,
    assistant_name: result.assistantName,
  });
}

/**
 * GET /api/voice/provision
 * Returns available phone numbers for assignment.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const numbers = await listVapiPhoneNumbers();
    return NextResponse.json({ numbers });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 }
    );
  }
}

/**
 * DELETE /api/voice/provision
 * Deprovisions the AI assistant for the workspace.
 */
export async function DELETE() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const config = await getVoiceConfig(auth.workspaceId);
  if (!config.vapi_assistant_id) {
    return NextResponse.json(
      { error: "No AI assistant is provisioned" },
      { status: 404 }
    );
  }

  // Delete from Vapi
  try {
    await deleteVapiAssistant(config.vapi_assistant_id);
  } catch (e) {
    // Log but don't block — might already be deleted on Vapi side
    console.error("Failed to delete Vapi assistant:", e);
  }

  // Clear the config
  await upsertVoiceConfig(auth.workspaceId, {
    enabled: false,
    vapi_assistant_id: null,
  });

  return NextResponse.json({ success: true });
}
