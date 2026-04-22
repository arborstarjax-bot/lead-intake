"use client";

import { useMemo, useState } from "react";
import {
  Car,
  Check,
  Clock,
  ListOrdered,
  Loader2,
  Wand2,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  formatClock,
  handleCalendarDisconnected,
  type RouteResponse,
  type Stop,
} from "../route-helpers";
import { DriveLeg } from "./DriveLeg";
import { ReorderArrows } from "./ReorderArrows";
import { StopMenu } from "./StopMenu";
import { TimelineRow } from "./TimelineRow";

export function StopList({
  data,
  onReload,
  onFlash,
}: {
  data: RouteResponse;
  onReload: () => void;
  onFlash: (msg: string) => void;
}) {
  // Manual reorder: local draft of the stop order. When non-null we're in
  // reorder mode — each row shows up/down arrows instead of the 3-dot menu
  // and a Save/Cancel bar appears at the bottom. Saving POSTs the ordered
  // lead IDs to /api/schedule/reorder which compacts start times back-to-
  // back from work_start using real drive legs and resyncs calendar.
  const [draft, setDraft] = useState<Stop[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-optimize: preview of the TSP-optimal order. When non-null the
  // Timeline shows the proposed order in amber with a diff summary +
  // Apply/Cancel bar. Separate state from the manual reorder draft so the
  // two flows never trip over each other.
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [optimizePreview, setOptimizePreview] = useState<{
    currentOrder: string[];
    optimalOrder: string[];
    currentDriveMinutes: number;
    optimalDriveMinutes: number;
    savingsMinutes: number;
  } | null>(null);
  const confirmDialog = useConfirm();

  const reordering = draft !== null;
  const previewingOptimize = optimizePreview !== null;
  const previewStopMap = useMemo(() => {
    if (!optimizePreview) return null;
    const byId = new Map(data.stops.map((s) => [s.id, s]));
    return optimizePreview.optimalOrder
      .map((id) => byId.get(id))
      .filter((s): s is Stop => !!s);
  }, [data.stops, optimizePreview]);
  const stops = previewStopMap ?? draft ?? data.stops;
  const dirty =
    draft !== null &&
    (draft.length !== data.stops.length ||
      draft.some((s, i) => s.id !== data.stops[i]?.id));

  function startReorder() {
    setError(null);
    setDraft(data.stops.slice());
  }

  function cancelReorder() {
    setDraft(null);
    setError(null);
  }

  async function runOptimize() {
    setOptimizing(true);
    setOptimizeError(null);
    setOptimizePreview(null);
    try {
      const res = await fetch(
        `/api/schedule/optimize-day?date=${encodeURIComponent(data.date)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setOptimizePreview({
        currentOrder: json.currentOrder,
        optimalOrder: json.optimalOrder,
        currentDriveMinutes: json.currentDriveMinutes,
        optimalDriveMinutes: json.optimalDriveMinutes,
        savingsMinutes: json.savingsMinutes,
      });
    } catch (e) {
      setOptimizeError((e as Error).message || "Failed to optimize");
    } finally {
      setOptimizing(false);
    }
  }

  function cancelOptimize() {
    setOptimizePreview(null);
    setOptimizeError(null);
  }

  async function applyOptimize() {
    if (!optimizePreview) return;
    setSaving(true);
    setOptimizeError(null);
    try {
      const res = await fetch("/api/schedule/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: data.date,
          orderedLeadIds: optimizePreview.optimalOrder,
        }),
      });
      const json = await res.json();
      if (await handleCalendarDisconnected(res, json, confirmDialog)) return;
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      const savings = optimizePreview.savingsMinutes;
      onFlash(
        savings > 0
          ? `Optimized · saved ~${savings} min of driving`
          : "Optimized route saved"
      );
      setOptimizePreview(null);
      onReload();
    } catch (e) {
      setOptimizeError((e as Error).message || "Failed to apply optimization");
    } finally {
      setSaving(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    if (!draft) return;
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = draft.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: data.date,
          orderedLeadIds: draft.map((s) => s.id),
        }),
      });
      const json = await res.json();
      if (await handleCalendarDisconnected(res, json, confirmDialog)) return;
      if (!res.ok) {
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      const parts: string[] = [];
      if (json.shifted) parts.push(`${json.shifted} stop${json.shifted === 1 ? "" : "s"} shifted`);
      if (json.overflowMinutes && json.overflowMinutes > 0) {
        parts.push(`ends ${json.overflowMinutes} min past work hours`);
      }
      onFlash(parts.length ? `Reordered · ${parts.join(" · ")}` : "Order saved");
      setDraft(null);
      onReload();
    } catch (e) {
      setError((e as Error).message || "Failed to save order");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
          <Car className="h-3.5 w-3.5" /> Timeline
        </div>
        {data.stops.length > 1 && !reordering && !previewingOptimize && (
          <div className="flex items-center gap-3">
            <button
              onClick={runOptimize}
              disabled={optimizing}
              className="text-xs font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1 disabled:opacity-60"
              title="Auto-reorder to minimize driving"
            >
              {optimizing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Optimize
            </button>
            <button
              onClick={startReorder}
              disabled={optimizing}
              className="text-xs font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1 disabled:opacity-60"
            >
              <ListOrdered className="h-3.5 w-3.5" /> Reorder
            </button>
          </div>
        )}
        {reordering && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 inline-flex items-center gap-1">
            <ListOrdered className="h-3.5 w-3.5" /> Reorder mode
          </div>
        )}
        {previewingOptimize && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 inline-flex items-center gap-1">
            <Wand2 className="h-3.5 w-3.5" /> Optimize preview
          </div>
        )}
      </div>

      {optimizeError && !previewingOptimize && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {optimizeError}
        </div>
      )}

      {previewingOptimize && optimizePreview && (
        <div className="mb-3 text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 space-y-1.5">
          {optimizePreview.savingsMinutes > 0 ? (
            <div className="font-semibold">
              Save ~{optimizePreview.savingsMinutes} min of driving today
            </div>
          ) : (
            <div className="font-semibold">
              Already close to optimal — no meaningful savings found
            </div>
          )}
          <div className="text-[11px] text-amber-800">
            Current: {optimizePreview.currentDriveMinutes} min driving · Proposed:{" "}
            {optimizePreview.optimalDriveMinutes} min. Apply will renumber start
            times from your work-start and resync Google Calendar.
          </div>
        </div>
      )}

      {reordering && (
        <div className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Use the arrows to change visit order. Saving will recompute every start
          time from your work-start using real drive legs and update Google
          Calendar.
        </div>
      )}

      <ol className="space-y-0">
        {data.home && (
          <TimelineRow
            kind="home"
            index={null}
            title="Home"
            subtitle={data.home.address}
          />
        )}
        {stops.map((s, i) => (
          <div key={s.id}>
            {!reordering && !previewingOptimize && s.driveMinutesFromPrev != null && (
              <DriveLeg minutes={s.driveMinutesFromPrev} />
            )}
            <TimelineRow
              kind="stop"
              index={i + 1}
              title={s.label}
              subtitle={
                <>
                  {!reordering && !previewingOptimize && (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatClock(s.startTime)}
                      </span>
                      <span className="mx-1.5 text-[var(--border)]">·</span>
                    </>
                  )}
                  <span className="truncate">{s.address}</span>
                </>
              }
              action={
                reordering ? (
                  <ReorderArrows
                    disabled={saving}
                    canUp={i > 0}
                    canDown={i < stops.length - 1}
                    onUp={() => move(i, -1)}
                    onDown={() => move(i, 1)}
                  />
                ) : previewingOptimize ? null : (
                  <StopMenu
                    leadId={s.id}
                    label={s.label}
                    firstName={s.firstName}
                    phoneNumber={s.phoneNumber}
                    salesPerson={s.salesPerson}
                    startTime={s.startTime}
                    date={data.date}
                    onReload={onReload}
                    onFlash={onFlash}
                  />
                )
              }
            />
          </div>
        ))}
        {!reordering && !previewingOptimize && data.home && data.returnDriveMinutes != null && data.stops.length > 0 && (
          <>
            <DriveLeg minutes={data.returnDriveMinutes} />
            <TimelineRow
              kind="home"
              index={null}
              title="Home"
              subtitle="End of day"
            />
          </>
        )}
      </ol>

      {reordering && (
        <div className="mt-3 space-y-2">
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={cancelReorder}
              disabled={saving}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-10 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="flex-1 rounded-full bg-[var(--accent)] text-white h-10 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {dirty ? "Save new order" : "No changes"}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {previewingOptimize && optimizePreview && (
        <div className="mt-3 space-y-2">
          {optimizeError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {optimizeError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={cancelOptimize}
              disabled={saving}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-10 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={applyOptimize}
              disabled={saving || optimizePreview.savingsMinutes === 0}
              className="flex-1 rounded-full bg-[var(--accent)] text-white h-10 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Applying…
                </>
              ) : optimizePreview.savingsMinutes > 0 ? (
                <>
                  <Check className="h-4 w-4" />
                  Apply optimization
                </>
              ) : (
                <>No improvement</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
