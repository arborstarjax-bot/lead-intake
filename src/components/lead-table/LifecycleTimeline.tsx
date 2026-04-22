"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LEAD_ACTIVITY_LABELS,
  type LeadActivity,
  type LeadActivityType,
} from "@/lib/types";

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

function TimelineRow({ activity }: { activity: LeadActivity }) {
  const isLifecycle =
    activity.type === "lead_intake" ||
    activity.type === "lead_scheduled" ||
    activity.type === "lead_completed";
  const dotClass = cn(
    "h-2 w-2 rounded-full flex-none mt-1.5",
    isLifecycle
      ? "bg-[var(--accent)]"
      : "bg-[var(--muted)]/60"
  );
  return (
    <div className="flex items-start gap-2">
      <div className={dotClass} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-[var(--fg)]">
          {LEAD_ACTIVITY_LABELS[activity.type]}
          {detailSuffix(activity)}
        </div>
        <div className="text-[10px] tabular-nums text-[var(--muted)]">
          {formatTimestamp(activity.created_at)}
        </div>
      </div>
    </div>
  );
}

function detailSuffix(activity: LeadActivity): string {
  const d = activity.details ?? {};
  if (
    activity.type === "customer_called" &&
    typeof d.outcome === "string"
  ) {
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
