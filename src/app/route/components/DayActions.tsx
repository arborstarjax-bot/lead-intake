"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { handleCalendarDisconnected, type RouteResponse } from "../route-helpers";

export function DayActions({
  data,
  onSynced,
  onUnbook,
}: {
  data: RouteResponse;
  onSynced: (msg: string) => void;
  onUnbook: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmDialog = useConfirm();

  // Suppress onUnbook warning — reserved for future inline actions that
  // need a reload hook (the current timeline menu handles its own reload
  // via onReload).
  void onUnbook;

  const needsSyncCount = useMemo(() => {
    // We don't get per-lead sync state from /route; fall back to always
    // offering the button when there are stops. The endpoint itself no-ops
    // for already-synced events.
    return data.stops.length;
  }, [data.stops.length]);

  async function syncDay() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/sync-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: data.date }),
      });
      const json = await res.json();
      if (await handleCalendarDisconnected(res, json, confirmDialog)) return;
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        return;
      }
      const s = json.summary as {
        total: number;
        created: number;
        updated: number;
        already: number;
        errors: number;
      };
      const parts: string[] = [];
      if (s.created) parts.push(`${s.created} added`);
      if (s.updated) parts.push(`${s.updated} updated`);
      if (s.already && !parts.length) parts.push("already in sync");
      if (s.errors) parts.push(`${s.errors} failed`);
      onSynced(`Calendar: ${parts.join(", ") || "done"}`);
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setSyncing(false);
    }
  }

  if (needsSyncCount === 0) return null;

  return (
    <div className="relative flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-3">
      <div className="min-w-0 text-sm">
        <div className="font-medium">Save day to calendar</div>
        <div className="text-xs text-[var(--muted)]">
          Push all {data.stops.length} stop{data.stops.length === 1 ? "" : "s"} to Google Calendar in one tap.
        </div>
      </div>
      <button
        onClick={syncDay}
        disabled={syncing}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg px-3 h-10 text-sm font-medium bg-[var(--accent)] text-white active:scale-[0.98] transition",
          syncing && "opacity-70"
        )}
      >
        {syncing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CalendarPlus className="h-4 w-4" />
        )}
        {syncing ? "Saving…" : "Save day"}
      </button>
      {error && (
        <div className="absolute right-4 mt-14 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
