"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LEAD_ACTIVITY_LABELS,
  type LeadActivity,
  type LeadActivityType,
} from "@/modules/leads/model";

/**
 * Collapsible per-lead lifecycle + activity timeline. Fetches lazily on
 * first expand so a tall LeadCard list doesn't hammer the activities
 * endpoint 50x on mount. Re-fetches on `refreshKey` bumps so parent can
 * trigger a reload after logging a call/text click.
 */
export function LifecycleTimeline({
  leadId,
  refreshKey = 0,
}: {
  leadId: string;
  /** Parent bumps this when it knows a new activity has been written
   *  server-side (call click, status change, etc.), so the timeline
   *  re-fetches once the drawer is open. */
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Refetch on initial open and on every refreshKey bump. This keeps the
    // "first open is free, subsequent updates stream in" behavior.
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/leads/${leadId}/activities`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setActivities([]);
        } else {
          setActivities(json.activities ?? []);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message || "Couldn't load timeline");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, leadId, refreshKey]);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Activity
        {loaded && activities.length > 0 && (
          <span className="text-[10px] text-[var(--muted)] normal-case font-normal tracking-normal">
            · {activities.length}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/40 p-2 space-y-1.5">
          {loading && !loaded && (
            <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5">
              <Clock className="h-3 w-3 animate-pulse" />
              Loading activity…
            </div>
          )}
          {error && (
            <div className="text-[11px] text-amber-700">{error}</div>
          )}
          {loaded && activities.length === 0 && (
            <div className="text-[11px] text-[var(--muted)]">
              No activity logged for this lead yet.
            </div>
          )}
          {activities.map((a) => (
            <TimelineRow key={a.id} activity={a} />
          ))}
        </div>
      )}
    </div>
  );
}

const LIFECYCLE_TYPES: LeadActivityType[] = [
  "lead_intake",
  "lead_scheduled",
  "lead_completed",
  "ai_called",
  "status_changed",
  "follow_up_set",
  "proposal_sent",
  "marked_sold",
  "marked_not_sold",
  "marked_lost",
  "marked_pending",
];

function TimelineRow({ activity }: { activity: LeadActivity }) {
  const isLifecycle = LIFECYCLE_TYPES.includes(activity.type);
  const dotClass = cn(
    "h-2 w-2 rounded-full flex-none mt-1.5",
    isLifecycle
      ? "bg-[var(--accent)]"
      : "bg-[var(--muted)]/60"
  );
  const d = activity.details ?? {};
  const aiSummary =
    activity.type === "ai_called" && typeof d.summary === "string" && d.summary
      ? d.summary
      : null;
  const recordingUrl =
    activity.type === "ai_called" && typeof d.recording_url === "string" && d.recording_url
      ? d.recording_url
      : null;

  return (
    <div className="flex items-start gap-2">
      <div className={dotClass} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-[var(--fg)]">
          {LEAD_ACTIVITY_LABELS[activity.type]}
          {detailSuffix(activity)}
        </div>
        {aiSummary && (
          <div className="text-[10px] text-[var(--fg)]/80 mt-0.5 whitespace-pre-wrap leading-relaxed">
            {aiSummary}
          </div>
        )}
        {recordingUrl && <RecordingPlayer url={recordingUrl} />}
        <div className="text-[10px] tabular-nums text-[var(--muted)]">
          {formatTimestamp(activity.created_at)}
        </div>
      </div>
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
      className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700 hover:bg-purple-100 transition-colors"
    >
      {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      {playing ? "Pause" : "Play Recording"}
    </button>
  );
}

function detailSuffix(activity: LeadActivity): string {
  const d = activity.details ?? {};
  if (activity.type === "customer_called" && typeof d.outcome === "string") {
    return ` · ${d.outcome}`;
  }
  if (activity.type === "ai_called" && typeof d.outcome === "string") {
    const dur = typeof d.duration_secs === "number" && d.duration_secs > 0
      ? ` (${Math.floor(d.duration_secs / 60)}m ${d.duration_secs % 60}s)`
      : "";
    return ` · ${d.outcome}${dur}`;
  }
  if (
    (activity.type === "marked_not_sold" || activity.type === "marked_lost" || activity.type === "follow_up_set") &&
    typeof d.reason === "string" && d.reason
  ) {
    return ` · ${d.reason}`;
  }
  if (activity.type === "status_changed" && typeof d.to === "string") {
    return ` → ${d.to}`;
  }
  if (activity.type === "proposal_sent" && typeof d.outcome === "string") {
    return ` · ${d.outcome}`;
  }
  return "";
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Fire-and-forget POST to log a user-initiated contact activity. Returns
 * the inserted row's id on success, or null on failure — callers should
 * never block UX on the result.
 */
export async function logContactActivity(
  leadId: string,
  type: Extract<LeadActivityType, "customer_called" | "customer_texted">,
  details: Record<string, unknown> = {}
): Promise<string | null> {
  try {
    const res = await fetch(`/api/leads/${leadId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, details }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.activity?.id ?? null;
  } catch {
    return null;
  }
}
