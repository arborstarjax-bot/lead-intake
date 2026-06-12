import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getCallByVapiId, updateCall } from "@/modules/voice/server";

export const runtime = "nodejs";

/**
 * Vapi call-status webhook. Fires when a call's status changes:
 * - status-update: ringing, in_progress, ended
 * - end-of-call-report: full transcript + recording after call ends
 *
 * Vapi payload:
 * {
 *   "message": {
 *     "type": "status-update" | "end-of-call-report",
 *     "call": { "id": "...", ... },
 *     "status": "ringing" | "in-progress" | "forwarding" | "ended",
 *     "endedReason": "...",
 *     "transcript": "...",
 *     "recordingUrl": "...",
 *     "summary": "...",
 *     ...
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const message = body.message as Record<string, unknown> | undefined;
  if (!message) {
    return NextResponse.json({ error: "no message" }, { status: 400 });
  }

  const type = message.type as string;
  const call = message.call as Record<string, unknown> | undefined;
  const vapiCallId = (call?.id as string) ?? (message.callId as string);

  if (!vapiCallId) {
    return NextResponse.json({ error: "no call id" }, { status: 400 });
  }

  const existingCall = await getCallByVapiId(vapiCallId);
  if (!existingCall) {
    // Call not tracked by us — might be from a different integration
    return NextResponse.json({ ok: true });
  }

  if (type === "status-update") {
    const status = message.status as string;
    const mapped = mapVapiStatus(status);
    await updateCall(existingCall.id, {
      status: mapped,
      ...(mapped === "in_progress" && !existingCall.started_at
        ? { started_at: new Date().toISOString() }
        : {}),
    });
  } else if (type === "end-of-call-report") {
    const now = new Date().toISOString();
    const transcript = message.transcript as string | undefined;
    const recordingUrl = message.recordingUrl as string | undefined;
    const summary = message.summary as string | undefined;
    const endedReason = message.endedReason as string | undefined;
    const durationSecs =
      existingCall.started_at
        ? Math.round(
            (Date.now() - new Date(existingCall.started_at).getTime()) / 1000
          )
        : null;

    const finalStatus = endedReasonToStatus(endedReason);

    await updateCall(existingCall.id, {
      status: finalStatus,
      ended_at: now,
      duration_secs: durationSecs,
      recording_url: recordingUrl ?? null,
      transcript: transcript ? [{ role: "system", content: transcript }] : null,
      call_summary: summary ?? null,
    });

    // Update lead's AI call tracking + append call summary to ai_notes
    const supabase = createAdminClient();
    const { data: currentLead } = await supabase
      .from("leads")
      .select("ai_notes")
      .eq("id", existingCall.lead_id)
      .maybeSingle();

    const timestamp = new Date(now).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const statusLabel =
      finalStatus === "completed"
        ? "Answered"
        : finalStatus === "no_answer"
        ? "No answer"
        : finalStatus === "voicemail"
        ? "Voicemail"
        : finalStatus === "transferred"
        ? "Transferred"
        : "Failed";
    const noteEntry = summary
      ? `[${timestamp}] ${statusLabel} — ${summary}`
      : `[${timestamp}] ${statusLabel}`;
    const existingNotes = (currentLead?.ai_notes as string) ?? "";
    const updatedNotes = existingNotes
      ? `${noteEntry}\n\n${existingNotes}`
      : noteEntry;

    await supabase
      .from("leads")
      .update({
        ai_last_call_at: now,
        ai_last_call_status: finalStatus,
        ai_notes: updatedNotes,
      })
      .eq("id", existingCall.lead_id);

    await supabase.rpc("increment_ai_call_count", {
      p_lead_id: existingCall.lead_id,
    }).then(() => {}, () => {
      // RPC may not exist yet — fall back to raw update
      return supabase
        .from("leads")
        .update({ ai_call_count: (existingCall.attempt_number ?? 0) + 1 })
        .eq("id", existingCall.lead_id);
    });

    // Queue follow-up if no answer
    if (finalStatus === "no_answer" || finalStatus === "voicemail") {
      await queueFollowUp(existingCall.workspace_id, existingCall.lead_id, finalStatus);
    }
  }

  return NextResponse.json({ ok: true });
}

function mapVapiStatus(status: string): string {
  switch (status) {
    case "ringing":
      return "ringing";
    case "in-progress":
      return "in_progress";
    case "forwarding":
      return "transferred";
    case "ended":
      return "completed";
    default:
      return status;
  }
}

function endedReasonToStatus(reason: string | undefined): string {
  if (!reason) return "completed";
  switch (reason) {
    case "customer-did-not-answer":
    case "customer-busy":
      return "no_answer";
    case "voicemail":
      return "voicemail";
    case "customer-ended-call":
    case "assistant-ended-call":
      return "completed";
    case "assistant-forwarded-call":
      return "transferred";
    case "phone-call-provider-closed-websocket":
    case "assistant-error":
      return "failed";
    default:
      return "completed";
  }
}

async function queueFollowUp(
  workspaceId: string,
  leadId: string,
  reason: string
) {
  const supabase = createAdminClient();
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour later
  await supabase.from("ai_call_follow_ups").insert({
    workspace_id: workspaceId,
    lead_id: leadId,
    reason,
    scheduled_at: scheduledAt,
    priority: reason === "voicemail" ? 3 : 5,
  });
}
