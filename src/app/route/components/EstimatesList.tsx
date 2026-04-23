"use client";

import { useState } from "react";
import {
  Check,
  ListOrdered,
  Loader2,
  MapPin,
  Wand2,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  formatClock,
  formatDateLong,
  handleCalendarDisconnected,
  type RouteResponse,
  type Stop,
} from "../route-helpers";
import { LEAD_FLEX_WINDOW_DISPLAY } from "@/lib/types";
import { EstimateRow } from "./EstimateRow";
import { FlexEstimateRow } from "./FlexEstimateRow";

/**
 * Single list of the day's estimates. Absorbs what used to be the separate
 * "Timeline" panel: drive-leg labels are rendered inline under each row,
 * and the Optimize / Reorder controls live in this card's header next to
 * the Save-day action. The list is the one source of truth for the day.
 */
export function EstimatesList({
  data,
  onReload,
  onFlash,
}: {
  data: RouteResponse;
  onReload: () => void;
  onFlash: (msg: string) => void;
}) {
  // Manual reorder: local draft of the stop order. When non-null we're in
  // reorder mode — each row shows up/down arrows instead of action icons
  // and a Save/Cancel bar appears at the bottom. Saving POSTs the ordered
  // lead IDs to /api/schedule/reorder which compacts start times back-to-
  // back from work_start using real drive legs and resyncs calendar.
  const [draft, setDraft] = useState<Stop[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flex-aware Optimize. Timed stops represent customer promises and
  // never move; the optimizer only proposes concrete times for the
  // day's flex-window leads. The preview shows one row per proposed
  // placement with the suggested start time; Apply writes the times
  // and clears flex_window on each lead.
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  type Placement = {
    leadId: string;
    label: string;
    startTime: string;
    flexWindow: "all_day" | "am" | "pm";
    insertAfter: string | null;
    addedDriveMinutes: number;
  };
  type OptimizeResponse = {
    date: string;
    placements: Placement[];
    unplaced: {
      leadId: string;
      label: string;
      flexWindow: string;
      reason: string;
    }[];
    addedDriveMinutes: number;
    nothingToDo: boolean;
  };
  const [optimizePreview, setOptimizePreview] =
    useState<OptimizeResponse | null>(null);
  const confirmDialog = useConfirm();

  const reordering = draft !== null;
  const previewingOptimize =
    optimizePreview !== null && optimizePreview.placements.length > 0;
  const stops = draft ?? data.stops;
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
      const json = (await res.json()) as OptimizeResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setOptimizePreview(json);
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
    if (!optimizePreview || optimizePreview.placements.length === 0) return;
    setSaving(true);
    setOptimizeError(null);
    try {
      const res = await fetch("/api/schedule/optimize-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: data.date,
          placements: optimizePreview.placements.map((p) => ({
            leadId: p.leadId,
            startTime: p.startTime,
          })),
        }),
      });
      const json = await res.json();
      if (await handleCalendarDisconnected(res, json, confirmDialog)) return;
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      const count = optimizePreview.placements.length;
      onFlash(
        count === 1
          ? `Placed 1 flex lead`
          : `Placed ${count} flex leads`
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

  async function saveOrder() {
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

  const flexStops = data.flexStops ?? [];
  const totalCount = data.stops.length + flexStops.length;
  const hasMultipleTimed = data.stops.length > 1;
  const hasFlex = flexStops.length > 0;
  const idle = !reordering && !previewingOptimize;
  // Reorder only makes sense for ≥2 timed stops; Optimize is flex-only
  // so it only shows when there's at least one flex lead on the day.
  const showReorder = idle && hasMultipleTimed;
  const showOptimize = idle && hasFlex;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Estimates ({totalCount})
        </div>
        <div className="flex items-center gap-3">
          {showOptimize && (
            <button
              onClick={runOptimize}
              disabled={optimizing}
              className="text-xs font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1 disabled:opacity-60"
              title="Assign times to flex leads by AM/PM and minimum drive"
            >
              {optimizing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Optimize flex
            </button>
          )}
          {showReorder && (
            <button
              onClick={startReorder}
              disabled={optimizing}
              className="text-xs font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1 disabled:opacity-60"
            >
              <ListOrdered className="h-3.5 w-3.5" /> Reorder
            </button>
          )}
          {reordering && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 inline-flex items-center gap-1">
              <ListOrdered className="h-3.5 w-3.5" /> Reorder mode
            </span>
          )}
          {previewingOptimize && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 inline-flex items-center gap-1">
              <Wand2 className="h-3.5 w-3.5" /> Flex preview
            </span>
          )}
          {!reordering && !previewingOptimize && (
            <span className="text-[11px] text-[var(--muted)]">
              {formatDateLong(data.date)}
            </span>
          )}
        </div>
      </div>

      {optimizeError && !previewingOptimize && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {optimizeError}
        </div>
      )}

      {optimizePreview &&
        optimizePreview.nothingToDo &&
        !reordering && (
          <div className="mb-3 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] px-3 py-2">
            No flex leads on this day — nothing to optimize. (Timed stops
            stay pinned to their customer-promised times.)
          </div>
        )}

      {previewingOptimize && optimizePreview && (
        <div className="mb-3 text-xs rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 space-y-1.5">
          <div className="font-semibold">
            {optimizePreview.placements.length === 1
              ? "1 flex lead ready to place"
              : `${optimizePreview.placements.length} flex leads ready to place`}
          </div>
          <ul className="space-y-0.5">
            {optimizePreview.placements.map((p) => (
              <li
                key={p.leadId}
                className="text-[11px] text-amber-900 flex items-baseline gap-2"
              >
                <span className="tabular-nums font-semibold">
                  {formatClock(p.startTime)}
                </span>
                <span className="truncate">{p.label}</span>
                <span className="text-[10px] text-amber-700 whitespace-nowrap">
                  · {LEAD_FLEX_WINDOW_DISPLAY[p.flexWindow]}
                </span>
              </li>
            ))}
          </ul>
          {optimizePreview.unplaced.length > 0 && (
            <div className="mt-1 pt-1 border-t border-amber-200 text-[11px] text-amber-800 space-y-0.5">
              <div className="font-semibold">Couldn&apos;t place:</div>
              {optimizePreview.unplaced.map((u) => (
                <div key={u.leadId} className="truncate">
                  • {u.label} — {u.reason}
                </div>
              ))}
            </div>
          )}
          <div className="text-[10px] text-amber-700">
            Apply will set each time and clear the flex window; timed stops stay
            untouched. Google Calendar will resync automatically.
          </div>
        </div>
      )}

      {optimizePreview &&
        !optimizePreview.nothingToDo &&
        optimizePreview.placements.length === 0 &&
        optimizePreview.unplaced.length > 0 && (
          <div className="mb-3 text-xs rounded-xl border border-red-200 bg-red-50 text-red-800 px-3 py-2 space-y-0.5">
            <div className="font-semibold">
              No flex lead could be placed in a feasible slot.
            </div>
            {optimizePreview.unplaced.map((u) => (
              <div key={u.leadId} className="truncate">
                • {u.label} — {u.reason}
              </div>
            ))}
          </div>
        )}

      {reordering && (
        <div className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Use the arrows to change visit order. Saving will recompute every start
          time from your work-start using real drive legs and update Google
          Calendar.
        </div>
      )}

      {stops.length > 0 && (
        <ul className="divide-y divide-[var(--border)]">
          {stops.map((s, i) => (
            <EstimateRow
              key={s.id}
              stop={s}
              index={i + 1}
              date={data.date}
              // Optimize now only retimes flex leads, so timed rows stay
              // in their normal look during preview — only the flex
              // section + the preview summary above change.
              mode={reordering ? "reorder" : "normal"}
              canUp={i > 0}
              canDown={i < stops.length - 1}
              onReorderUp={() => move(i, -1)}
              onReorderDown={() => move(i, 1)}
              reorderBusy={saving}
              onReload={onReload}
              onFlash={onFlash}
            />
          ))}
        </ul>
      )}

      {/* Flex-window leads on this day. Grouped below the timed stops
          (or alone when the day has no pinned times yet) since they
          don't participate in the numbered route sequence. Tapping the
          "Flex — …" label on a row opens the scheduler so the operator
          can pin a specific time, which then promotes the row into the
          timed list on reload. Hidden during reorder/optimize preview
          modes because those flows only reshuffle timed stops. */}
      {!reordering && !previewingOptimize && flexStops.length > 0 && (
        <div className={stops.length > 0 ? "mt-4" : ""}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
            Flex · no time assigned
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {flexStops.map((s) => (
              <FlexEstimateRow
                key={s.id}
                stop={s}
                date={data.date}
                onReload={onReload}
                onFlash={onFlash}
              />
            ))}
          </ul>
        </div>
      )}

      {reordering && (
        <div className="mt-3 space-y-2">
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
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
              onClick={saveOrder}
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

      {optimizePreview && (previewingOptimize || optimizePreview.unplaced.length > 0 || optimizePreview.nothingToDo) && (
        <div className="mt-3 space-y-2">
          {optimizeError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {optimizeError}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={cancelOptimize}
              disabled={saving}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-10 text-sm font-medium disabled:opacity-60"
            >
              {previewingOptimize ? "Cancel" : "Close"}
            </button>
            {previewingOptimize && (
            <button
              onClick={applyOptimize}
              disabled={saving || optimizePreview.placements.length === 0}
              className="flex-1 rounded-full bg-[var(--accent)] text-white h-10 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Applying…
                </>
              ) : optimizePreview.placements.length > 0 ? (
                <>
                  <Check className="h-4 w-4" />
                  {optimizePreview.placements.length === 1
                    ? "Place 1 flex lead"
                    : `Place ${optimizePreview.placements.length} flex leads`}
                </>
              ) : (
                <>No placements</>
              )}
            </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
