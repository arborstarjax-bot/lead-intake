import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getCallByVapiId, updateCall } from "@/modules/voice/server";
import { sendWorkspacePush } from "@/lib/push";
import { getSettings } from "@/lib/settings";

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
    const artifact = message.artifact as Record<string, unknown> | undefined;
    const recordingUrl = (message.recordingUrl ?? artifact?.recordingUrl ?? artifact?.recording) as string | undefined;
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
      .select("ai_notes, ai_call_count, client, first_name, last_name")
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

    // Determine the appropriate follow_up_result sub-category
    const followUpResult = getFollowUpResult(finalStatus, summary ?? null);

    const leadUpdate: Record<string, unknown> = {
      ai_last_call_at: now,
      ai_last_call_status: finalStatus,
      ai_notes: updatedNotes,
      ai_call_count: ((currentLead?.ai_call_count as number) ?? 0) + 1,
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
        leadUpdate.follow_up_result = followUpResult;
      }
    }

    await supabase
      .from("leads")
      .update(leadUpdate)
      .eq("id", existingCall.lead_id);

    // ai_call_count is now included in the main leadUpdate above

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
        recording_url: recordingUrl ?? null,
      },
    });

    // Push notification for every AI call result — include full details
    const leadName = currentLead?.client
      ?? ([currentLead?.first_name, currentLead?.last_name].filter(Boolean).join(" ") || "Lead");
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

  const currentCount = (campaign.completed_leads as number) ?? 0;
  const completedCount = currentCount + 1;
  const nextIdx = currentIdx + 1;
  const isFinished = nextIdx >= queue.length;

  // Atomic update: only the first invocation wins by requiring completed_leads
  // hasn't been incremented yet. Prevents duplicate calls from race conditions
  // when Vapi sends duplicate end-of-call-report webhooks.
  const { data: updatedRows } = await supabase
    .from("ai_campaigns")
    .update({
      completed_leads: completedCount,
      results,
      current_lead_id: isFinished ? null : queue[nextIdx],
      status: isFinished ? "completed" : "running",
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign.id)
    .eq("completed_leads", currentCount)
    .select("id");

  // If 0 rows updated, another invocation already advanced — bail out
  if (!updatedRows || updatedRows.length === 0) return;

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

  // Respect work_days/calling hours — pause campaign if outside window
  const settings = await getSettings(workspaceId);
  if (!isWithinCallWindow(settings)) {
    await supabase
      .from("ai_campaigns")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
    sendWorkspacePush({
      workspaceId,
      title: "Campaign Paused",
      body: "Outside calling hours — campaign will resume during next work window.",
      url: "/leads",
      tag: `campaign-${campaign.id}`,
    }).catch(() => {});
    return;
  }

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

/**
 * Determine the appropriate follow_up_result sub-category based on call outcome.
 * Maps to the FOLLOW_UP_RESULTS enum: "Called — No Answer", "Left Voicemail",
 * "Spoke With Customer", "Requested Callback", etc.
 */
function getFollowUpResult(finalStatus: string, summary: string | null): string {
  if (finalStatus === "no_answer") return "Called — No Answer";
  if (finalStatus === "voicemail") return "Left Voicemail";
  if (finalStatus === "failed") return "Called — No Answer";

  // For completed calls, analyze the summary to determine sub-category
  if (finalStatus === "completed" && summary) {
    const lower = summary.toLowerCase();

    // Decision maker — needs spouse/family/HOA approval
    if (
      lower.includes("spouse") ||
      lower.includes("wife") ||
      lower.includes("husband") ||
      lower.includes("decision maker") ||
      lower.includes("landlord") ||
      lower.includes("hoa") ||
      lower.includes("need to check with") ||
      lower.includes("needs approval")
    ) {
      return "Awaiting Decision Maker";
    }

    // Price shopping — comparing quotes
    if (
      lower.includes("price shopping") ||
      lower.includes("other quotes") ||
      lower.includes("comparing") ||
      lower.includes("getting other estimates") ||
      lower.includes("shopping around") ||
      lower.includes("how much")
    ) {
      return "Price Shopping";
    }

    // Could not connect — anti-loop triggered or couldn't progress
    if (
      lower.includes("could not progress") ||
      lower.includes("unable to schedule") ||
      lower.includes("could not connect") ||
      lower.includes("no meaningful conversation") ||
      lower.includes("disconnected before")
    ) {
      return "Could Not Connect";
    }

    // Callback requested
    if (
      lower.includes("call back") ||
      lower.includes("call you back") ||
      lower.includes("callback") ||
      lower.includes("call us back") ||
      lower.includes("requested callback") ||
      lower.includes("busy") ||
      lower.includes("not a good time") ||
      lower.includes("can't talk")
    ) {
      return "Requested Callback";
    }

    // They answered and talked but didn't book
    return "Spoke With Customer";
  }

  return "Called — No Answer";
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

function isWithinCallWindow(settings: {
  work_start_time: string;
  work_end_time: string;
  work_days: number[];
  timezone: string;
}): boolean {
  const now = new Date();
  const tz = settings.timezone;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });

  const timeStr = formatter.format(now);
  const dayStr = dayFormatter.format(now);

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayNum = dayMap[dayStr] ?? 0;

  const start = settings.work_start_time.slice(0, 5);
  const end = settings.work_end_time.slice(0, 5);

  if (!settings.work_days.includes(dayNum)) return false;
  if (timeStr < start) return false;
  if (timeStr >= end) return false;

  return true;
}
