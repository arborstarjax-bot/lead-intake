"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Bot, Phone, Clock, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

type AiCallRecord = {
  id: string;
  status: string;
  duration_secs: number | null;
  call_summary: string | null;
  recording_url: string | null;
  created_at: string;
  ended_at: string | null;
  started_at: string | null;
};

/**
 * Collapsible AI Call History section on the lead card. Fetches from the
 * `ai_calls` table (the source of truth) and shows every call with status,
 * duration, summary, and recording playback.
 */
export function AiCallHistory({
  leadId,
  refreshKey = 0,
}: {
  leadId: string;
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [calls, setCalls] = useState<AiCallRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/leads/${leadId}/ai-calls`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setCalls([]);
        } else {
          setCalls(json.calls ?? []);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message || "Couldn't load AI call history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId, refreshKey]);

  // Reset loaded state when refreshKey changes so the panel re-fetches
  // next time it's opened (e.g. after an AI call completes).
  useEffect(() => {
    setLoaded(false);
  }, [refreshKey]);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-600 hover:text-purple-800 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Bot className="h-3.5 w-3.5" />
        AI Call History
        {loaded && calls.length > 0 && (
          <span className="text-[10px] text-purple-500 normal-case font-normal tracking-normal">
            · {calls.length} call{calls.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-purple-200 bg-purple-50/30 p-2 space-y-2">
          {loading && !loaded && (
            <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
              <Clock className="h-3 w-3 animate-pulse" />
              Loading call history…
            </div>
          )}
          {error && (
            <div className="text-[11px] text-amber-700">{error}</div>
          )}
          {loaded && calls.length === 0 && (
            <div className="text-[11px] text-[var(--muted)]">
              No AI calls yet.
            </div>
          )}
          {calls.map((call) => (
            <CallRow key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}

function CallRow({ call }: { call: AiCallRecord }) {
  const statusLabel = getStatusLabel(call.status);
  const statusColor = getStatusColor(call.status);
  const duration = formatDuration(call.duration_secs);

  return (
    <div className="rounded-md border border-purple-100 bg-white p-2">
      <div className="flex items-center gap-1.5">
        <Phone className="h-3 w-3 text-purple-500 flex-none" />
        <span className={cn("text-[11px] font-semibold", statusColor)}>
          {statusLabel}
        </span>
        {duration && (
          <span className="text-[10px] text-[var(--muted)]">({duration})</span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-[var(--muted)]">
          {formatTimestamp(call.created_at)}
        </span>
      </div>
      {call.call_summary && (
        <div className="mt-1 text-[10px] text-[var(--fg)]/80 whitespace-pre-wrap leading-relaxed">
          {call.call_summary}
        </div>
      )}
      {call.recording_url && (
        <div className="mt-1">
          <RecordingPlayer url={call.recording_url} />
        </div>
      )}
    </div>
  );
}

function RecordingPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioEl) {
        audioEl.pause();
      }
    };
  }, [audioEl]);

  function toggle() {
    if (playing && audioEl) {
      audioEl.pause();
      setPlaying(false);
      return;
    }
    const audio = audioEl ?? new Audio(url);
    if (!audioEl) {
      audio.addEventListener("ended", () => setPlaying(false));
      audio.addEventListener("error", () => setPlaying(false));
      setAudioEl(audio);
    }
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-100 transition-colors"
    >
      {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      {playing ? "Pause" : "Play Recording"}
    </button>
  );
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Answered";
    case "no_answer":
      return "No Answer";
    case "voicemail":
      return "Left Voicemail";
    case "failed":
      return "Failed";
    case "in_progress":
      return "In Progress";
    case "ringing":
      return "Ringing";
    case "queued":
      return "Queued";
    case "transferred":
      return "Transferred";
    default:
      return status;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-green-700";
    case "no_answer":
      return "text-orange-600";
    case "voicemail":
      return "text-amber-600";
    case "failed":
      return "text-red-600";
    case "in_progress":
    case "ringing":
    case "queued":
      return "text-blue-600";
    default:
      return "text-[var(--fg)]";
  }
}

function formatDuration(secs: number | null): string | null {
  if (secs == null || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
