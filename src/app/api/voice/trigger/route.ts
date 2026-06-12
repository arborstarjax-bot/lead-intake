import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSessionMembership } from "@/modules/auth/server";
import {
  getVoiceConfig,
  insertCall,
  getActiveCallCount,
  createOutboundCall,
} from "@/modules/voice/server";

export const runtime = "nodejs";

/**
 * Trigger an AI voice call for a specific lead.
 *
 * Called by:
 * 1. Supabase webhook / edge function on new-lead creation (auto-call)
 *    — provides workspace_id in the body
 * 2. Manual "Call Lead" button from the UI
 *    — resolves workspace_id from authenticated session
 *
 * Body: { lead_id, workspace_id?, manual?: boolean }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const leadId = body.lead_id as string;
  const manual = body.manual === true;
  let workspaceId = body.workspace_id as string | undefined;

  if (!leadId) {
    return NextResponse.json(
      { error: "lead_id is required" },
      { status: 400 }
    );
  }

  // If workspace_id not provided, resolve from authenticated session
  if (!workspaceId) {
    const membership = await getSessionMembership();
    if (!membership) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    workspaceId = membership.workspaceId;
  }

  // Load voice config
  const config = await getVoiceConfig(workspaceId);

  if (!config.enabled) {
    return NextResponse.json(
      { error: "Voice agent is not enabled for this workspace" },
      { status: 403 }
    );
  }

  if (!config.vapi_assistant_id || !config.vapi_phone_id) {
    return NextResponse.json(
      { error: "Vapi assistant or phone number not configured" },
      { status: 422 }
    );
  }

  // Check calling window (skip for manual triggers)
  if (!manual && !isWithinCallWindow(config)) {
    return NextResponse.json(
      { error: "Outside calling hours", scheduled: true },
      { status: 200 }
    );
  }

  // Check concurrency limit
  const active = await getActiveCallCount(workspaceId);
  if (active >= config.concurrent_calls) {
    return NextResponse.json(
      { error: "Concurrent call limit reached", retry: true },
      { status: 429 }
    );
  }

  // Load lead
  const supabase = createAdminClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, first_name, last_name, phone_number, address, city, state, zip, status, lead_source, ai_do_not_call, ai_call_count")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (lead.ai_do_not_call) {
    return NextResponse.json({ error: "Lead is on DNC list" }, { status: 403 });
  }

  if (!lead.phone_number) {
    return NextResponse.json(
      { error: "Lead has no phone number" },
      { status: 422 }
    );
  }

  if (!manual && (lead.ai_call_count ?? 0) >= config.max_attempts) {
    return NextResponse.json(
      { error: "Max call attempts reached" },
      { status: 422 }
    );
  }

  // Create the call record
  const callRecord = await insertCall({
    workspace_id: workspaceId,
    lead_id: leadId,
    to_number: lead.phone_number,
    from_number: config.vapi_phone_id,
    attempt_number: (lead.ai_call_count ?? 0) + 1,
    status: "queued",
  });

  // Place the call via Vapi
  try {
    const vapiResponse = await createOutboundCall({
      assistantId: config.vapi_assistant_id,
      phoneNumberId: config.vapi_phone_id,
      customerNumber: lead.phone_number,
      assistantOverrides: {
        variableValues: {
          lead_id: lead.id,
          first_name: lead.first_name ?? "",
          last_name: lead.last_name ?? "",
          address: lead.address ?? "",
          city: lead.city ?? "",
          state: lead.state ?? "",
          zip: lead.zip ?? "",
          lead_source: lead.lead_source ?? "",
          company_name: config.company_name ?? "",
          agent_name: config.agent_name,
        },
      },
    });

    // Update the call record with Vapi's call ID
    const { updateCall } = await import("@/modules/voice/server");
    await updateCall(callRecord.id, {
      vapi_call_id: vapiResponse.id,
      status: "ringing",
    });

    return NextResponse.json({
      success: true,
      call_id: callRecord.id,
      vapi_call_id: vapiResponse.id,
    });
  } catch (e) {
    const { updateCall } = await import("@/modules/voice/server");
    await updateCall(callRecord.id, {
      status: "failed",
      failure_reason: (e as Error).message,
    });
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

function isWithinCallWindow(config: {
  call_window_start: string;
  call_window_end: string;
  call_days: number[];
  timezone: string;
}): boolean {
  const now = new Date();
  // Get current time in workspace timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "short",
  });

  const timeStr = formatter.format(now); // "09:30" format
  const dayStr = dayFormatter.format(now);

  // Map day string to number (1=Mon..7=Sun)
  const dayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const dayNum = dayMap[dayStr] ?? 0;

  if (!config.call_days.includes(dayNum)) return false;
  if (timeStr < config.call_window_start) return false;
  if (timeStr >= config.call_window_end) return false;

  return true;
}
