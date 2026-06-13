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
 * Shows "Called" state + last call status underneath after a call.
 * Expandable dropdown shows full call notes/summary.
 */
export function AiCallButton({
  leadId,
  callInfo,
  onCallTriggered,
  compact,
}: {
  leadId: string;
  callInfo?: AiCallInfo;
  onCallTriggered?: () => void;
  /** Render as a row-friendly action button (no notes/status below). */
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<"idle" | "success" | "error">("idle");
  const [expanded, setExpanded] = useState(false);
  const [localCallInfo, setLocalCallInfo] = useState<AiCallInfo | undefined>(callInfo);

  // Detect "has been called" using multiple signals — ai_call_count may
  // be stale/zero for calls made before the increment fix (PR #215).
  const hasCalled =
    (localCallInfo?.ai_call_count ?? 0) > 0 ||
    Boolean(localCallInfo?.ai_last_call_status) ||
    Boolean(localCallInfo?.ai_notes);

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
        setLocalCallInfo((prev) => ({
          ai_call_count: (prev?.ai_call_count ?? 0) + 1,
          ai_last_call_at: new Date().toISOString(),
          ai_last_call_status: "in_progress",
          ai_notes: prev?.ai_notes ?? null,
        }));
        onCallTriggered?.();
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

  const statusLabel = getStatusLabel(localCallInfo?.ai_last_call_status);

  // ── Compact mode: single inline button for the quick-action row ──
  if (compact) {
    return (
      <button
        type="button"
        onClick={trigger}
        disabled={loading}
        title={hasCalled ? "Call again with AI voice agent" : "AI Call — voice agent calls this lead now"}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 w-full h-11 rounded-xl text-[13px] font-semibold transition active:scale-[0.97]",
          result === "success"
            ? "bg-green-100 text-green-700"
            : result === "error"
            ? "bg-red-100 text-red-700"
            : hasCalled
            ? "bg-purple-800 text-white hover:bg-purple-900"
            : "bg-[#111] text-white hover:bg-[#222]"
        )}
      >
        {hasCalled ? <Phone className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        {loading
          ? "Calling…"
          : result === "success"
          ? "Call placed"
          : result === "error"
          ? "Failed"
          : hasCalled
          ? `Called${(localCallInfo?.ai_call_count ?? 0) > 1 ? ` ${localCallInfo!.ai_call_count}×` : ""}`
          : "AI Call"}
      </button>
    );
  }

  // ── Standard mode: full button with status + notes below ──
  return (
    <div className="flex flex-col gap-0.5">
      {/* Button row */}
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
        {hasCalled && localCallInfo?.ai_notes && localCallInfo.ai_notes.includes("\n\n") && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Show latest call only" : "Show all call history"}
            className="inline-flex items-center justify-center h-8 w-6 rounded-md text-purple-600 hover:bg-purple-50 transition"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Status line — always visible after a call */}
      {hasCalled && statusLabel && (
        <div className="flex items-center gap-1.5 pl-0.5">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              localCallInfo?.ai_last_call_status === "completed"
                ? "bg-green-500"
                : localCallInfo?.ai_last_call_status === "voicemail"
                ? "bg-amber-500"
                : localCallInfo?.ai_last_call_status === "no_answer"
                ? "bg-orange-500"
                : localCallInfo?.ai_last_call_status === "in_progress"
                ? "bg-blue-500"
                : "bg-red-500"
            )}
          />
          <span className="text-[10px] text-[var(--muted)] font-medium">
            {statusLabel}
          </span>
          {localCallInfo?.ai_last_call_at && (
            <span className="text-[10px] text-[var(--muted)] tabular-nums">
              · {formatRelativeTime(localCallInfo.ai_last_call_at)}
            </span>
          )}
          {(localCallInfo?.ai_call_count ?? 0) > 1 && (
            <span className="text-[10px] text-[var(--muted)]">
              · {localCallInfo!.ai_call_count} calls
            </span>
          )}
        </div>
      )}

      {/* AI call notes — always visible when calls have been made */}
      {hasCalled && localCallInfo?.ai_notes && (
        <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-2 text-[10px] text-[var(--fg)] whitespace-pre-wrap leading-relaxed mt-1 max-h-40 overflow-y-auto">
          {expanded
            ? localCallInfo.ai_notes
            : getLatestNote(localCallInfo.ai_notes)}
        </div>
      )}
    </div>
  );
}

function getStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  switch (status) {
    case "completed":
      return "Answered";
    case "no_answer":
      return "No answer";
    case "voicemail":
      return "Left VM";
    case "failed":
      return "Failed";
    case "in_progress":
      return "In progress";
    case "transferred":
      return "Transferred";
    default:
      return status;
  }
}

function getLatestNote(notes: string): string {
  // Notes are separated by double newlines, newest first
  const firstNote = notes.split("\n\n")[0] ?? notes;
  return firstNote;
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
