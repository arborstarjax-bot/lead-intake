"use client";

import { useState } from "react";
import { Bot, ChevronDown, ChevronUp, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

type AiCallInfo = {
  ai_call_count: number | null;
  ai_last_call_at: string | null;
  ai_last_call_status: string | null;
  ai_notes: string | null;
};

/**
 * "AI Call" button shown on the lead card. Triggers the voice agent to
 * call this lead immediately (manual trigger, ignoring call window).
 * Shows "Called" state after a call has been placed. Includes a dropdown
 * toggle to view AI call history/tracking.
 */
export function AiCallButton({
  leadId,
  callInfo,
}: {
  leadId: string;
  callInfo?: AiCallInfo;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<"idle" | "success" | "error">("idle");
  const [expanded, setExpanded] = useState(false);
  const [localCallInfo, setLocalCallInfo] = useState<AiCallInfo | undefined>(callInfo);

  const hasCalled = (localCallInfo?.ai_call_count ?? 0) > 0;

  async function trigger() {
    if (loading) return;
    setLoading(true);
    setResult("idle");
    try {
      const res = await fetch("/api/voice/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, manual: true }),
      });
      if (res.ok) {
        setResult("success");
        // Update local state to reflect the call was placed
        setLocalCallInfo((prev) => ({
          ai_call_count: (prev?.ai_call_count ?? 0) + 1,
          ai_last_call_at: new Date().toISOString(),
          ai_last_call_status: prev?.ai_last_call_status ?? null,
          ai_notes: prev?.ai_notes ?? null,
        }));
      } else {
        const json = await res.json().catch(() => ({}));
        console.error("AI call trigger failed:", json);
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setLoading(false);
      setTimeout(() => setResult("idle"), 3000);
    }
  }

  const statusLabel = localCallInfo?.ai_last_call_status
    ? localCallInfo.ai_last_call_status === "completed"
      ? "Answered"
      : localCallInfo.ai_last_call_status === "no_answer"
      ? "No answer"
      : localCallInfo.ai_last_call_status === "voicemail"
      ? "Voicemail"
      : localCallInfo.ai_last_call_status === "failed"
      ? "Failed"
      : localCallInfo.ai_last_call_status
    : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={trigger}
          disabled={loading}
          title={hasCalled ? "Call again with AI voice agent" : "AI Call — voice agent calls this lead now"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-xs font-medium transition active:scale-[0.97]",
            result === "success"
              ? "bg-green-100 text-green-700"
              : result === "error"
              ? "bg-red-100 text-red-700"
              : hasCalled
              ? "bg-purple-100 text-purple-800 hover:bg-purple-200 border border-purple-300"
              : "bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200"
          )}
        >
          {hasCalled ? <Phone className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          {loading
            ? "Calling…"
            : result === "success"
            ? "Call placed"
            : result === "error"
            ? "Failed"
            : hasCalled
            ? "Called"
            : "AI Call"}
        </button>
        {hasCalled && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            title="View AI call details"
            className="inline-flex items-center justify-center h-8 w-6 rounded-md text-purple-600 hover:bg-purple-50 transition"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {expanded && hasCalled && (
        <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-2 text-[11px] space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-purple-800">
              {statusLabel ?? "Called"}
            </span>
            <span className="text-[10px] text-purple-600 tabular-nums">
              {localCallInfo?.ai_last_call_at
                ? formatRelativeTime(localCallInfo.ai_last_call_at)
                : ""}
            </span>
          </div>
          {(localCallInfo?.ai_call_count ?? 0) > 1 && (
            <div className="text-[10px] text-purple-600">
              {localCallInfo!.ai_call_count} calls total
            </div>
          )}
          {localCallInfo?.ai_notes && (
            <div className="text-[10px] text-[var(--fg)] whitespace-pre-wrap leading-relaxed border-t border-purple-200 pt-1 mt-1">
              {localCallInfo.ai_notes.length > 200
                ? localCallInfo.ai_notes.slice(0, 200) + "…"
                : localCallInfo.ai_notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}
