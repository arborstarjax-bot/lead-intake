import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getCallByVapiId, updateCall } from "@/modules/voice/server";
import { sendWorkspacePush } from "@/lib/push";

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
      .select("ai_notes, client, first_name, last_name")
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
    const durationDisplay = durationSecs
      ? ` (${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s)`
      : "";
    const noteEntry = summary
      ? `[${timestamp}] ${statusLabel}${durationDisplay} — ${summary}`
      : `[${timestamp}] ${statusLabel}${durationDisplay}`;
    const existingNotes = (currentLead?.ai_notes as string) ?? "";
    const updatedNotes = existingNotes
      ? `${noteEntry}\n\n${existingNotes}`
      : noteEntry;

    // Determine if lead should be moved to "Called / No Response" (Needs Followup)
    // Only move if currently "New" — don't regress leads that are already Scheduled/Pending/etc.
    const shouldMoveToFollowUp =
      finalStatus === "no_answer" ||
      finalStatus === "voicemail" ||
      finalStatus === "failed" ||
      (finalStatus === "completed" && !summary?.toLowerCase().includes("booked"));

    const leadUpdate: Record<string, unknown> = {
      ai_last_call_at: now,
      ai_last_call_status: finalStatus,
      ai_notes: updatedNotes,
    };

    if (shouldMoveToFollowUp) {
      // Only move "New" leads — don't override "Scheduled" etc.
      const { data: leadStatus } = await supabase
        .from("leads")
        .select("status")
        .eq("id", existingCall.lead_id)
        .maybeSingle();
      if (leadStatus?.status === "New") {
        leadUpdate.status = "Called / No Response";
      }
    }

    await supabase
      .from("leads")
      .update(leadUpdate)
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

    // Log ai_called activity to the lead's timeline
    await supabase.from("lead_activities").insert({
      workspace_id: existingCall.workspace_id,
      lead_id: existingCall.lead_id,
      type: "ai_called",
      details: {
        outcome: statusLabel,
        summary: summary ?? null,
        duration_secs: durationSecs,
        call_id: existingCall.id,
      },
    });

    // Push notification for every AI call result — include full details
    const leadName = currentLead?.client ?? [currentLead?.first_name, currentLead?.last_name].filter(Boolean).join(" ") ?? "Lead";
    const durationStr = durationSecs ? `${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s` : "";
    const notifBody = summary
      ? `${leadName}${durationStr ? ` (${durationStr})` : ""}\n${summary}`
      : `${leadName}${durationStr ? ` — ${durationStr}` : ""} — ${statusLabel}`;
    sendWorkspacePush({
      workspaceId: existingCall.workspace_id,
      title: `AI Call: ${statusLabel}`,
      body: notifBody,
      url: "/leads",
      tag: `ai-call-${existingCall.id}`,
    }).catch(() => {});

    // Queue follow-up if no answer
    if (finalStatus === "no_answer" || finalStatus === "voicemail") {
      await queueFollowUp(existingCall.workspace_id, existingCall.lead_id, finalStatus);
    }

    // Campaign auto-advance: if this call was part of a campaign, trigger next
    await advanceCampaign(existingCall.workspace_id, existingCall.lead_id, statusLabel, summary ?? null);
  }

  return NextResponse.json({ ok: true });
}

/**
 * Check if the completed call was part of an active campaign and advance to the next lead.
 */
async function advanceCampaign(
  workspaceId: string,
  completedLeadId: string,
  outcome: string,
  summary: string | null
) {
  const supabase = createAdminClient();

  // Find running campaign for this workspace
  const { data: campaign } = await supabase
    .from("ai_campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!campaign) return;

  const queue = campaign.lead_queue as string[];
  const currentIdx = queue.indexOf(completedLeadId);
  if (currentIdx === -1) return; // Not part of this campaign

  // Get lead name for results
  const { data: leadRow } = await supabase
    .from("leads")
    .select("client, first_name, last_name")
    .eq("id", completedLeadId)
    .maybeSingle();
  const leadName = leadRow?.client ?? ([leadRow?.first_name, leadRow?.last_name].filter(Boolean).join(" ") || "Lead");

  // Update results
  const results = (campaign.results as Array<Record<string, unknown>>) ?? [];
  results.push({ lead_id: completedLeadId, name: leadName, outcome, summary });

  const completedCount = results.length;
  const nextIdx = currentIdx + 1;
  const isFinished = nextIdx >= queue.length;

  await supabase
    .from("ai_campaigns")
    .update({
      completed_leads: completedCount,
      results,
      current_lead_id: isFinished ? null : queue[nextIdx],
      status: isFinished ? "completed" : "running",
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign.id);

  if (isFinished) {
    // Send completion notification
    sendWorkspacePush({
      workspaceId,
      title: "Campaign Complete",
      body: `${completedCount} leads called. ${results.filter((r) => r.outcome === "Answered").length} answered, ${results.filter((r) => r.outcome === "Left VM" || r.outcome === "Voicemail").length} voicemail, ${results.filter((r) => r.outcome === "No answer").length} no answer.`,
      url: "/leads",
      tag: `campaign-${campaign.id}`,
    }).catch(() => {});
    return;
  }

  // Wait 5 seconds before next call to avoid overwhelming Vapi
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Check if campaign was paused/cancelled during the wait
  const { data: refreshed } = await supabase
    .from("ai_campaigns")
    .select("status")
    .eq("id", campaign.id)
    .maybeSingle();
  if (refreshed?.status !== "running") return;

  // Trigger next call
  const nextLeadId = queue[nextIdx];
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const triggerRes = await fetch(`${baseUrl}/api/voice/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lead_id: nextLeadId, workspace_id: workspaceId, manual: true }),
  });

  if (!triggerRes.ok) {
    // If trigger fails, record failure and try next
    const err = await triggerRes.json().catch(() => ({}));
    const { data: failedLead } = await supabase
      .from("leads")
      .select("client, first_name, last_name")
      .eq("id", nextLeadId)
      .maybeSingle();
    const failedName = failedLead?.client ?? ([failedLead?.first_name, failedLead?.last_name].filter(Boolean).join(" ") || "Lead");
    results.push({ lead_id: nextLeadId, name: failedName, outcome: "Failed", summary: err.error ?? "Trigger failed" });

    // Recursively advance past failed leads
    await advanceCampaign(workspaceId, nextLeadId, "Failed", err.error ?? "Trigger failed");
  }
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
    case "silence-timed-out":
      return "no_answer";
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
