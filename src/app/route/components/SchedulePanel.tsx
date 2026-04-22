"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck,
  CalendarSearch,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  formatClock,
  formatDateLong,
  handleCalendarDisconnected,
  type Half,
  type Slot,
} from "../route-helpers";
import { HalfTabs } from "./HalfTabs";

type DayOption = {
  date: string;
  bestTotalDriveMinutes: number | null;
  effectiveBestMinutes: number | null;
  slotCount: number;
  clusterBonusMinutes: number;
};

export function SchedulePanel({
  leadId,
  leadLabel,
  selectedDay,
  previewSlot,
  onPreview,
  onHeightChange,
  onBooked,
  onSelectDay,
}: {
  leadId: string;
  leadLabel: string;
  selectedDay: string;
  previewSlot: Slot | null;
  onPreview: (slot: Slot | null) => void;
  onHeightChange: (h: number) => void;
  onBooked: (msg: string) => void;
  /** Called when the user picks a different day from "Find best day". */
  onSelectDay: (day: string) => void;
}) {
  // Report the panel's rendered height to the parent so it can reserve
  // matching bottom padding and keep the Timeline visible above the fixed
  // panel. The height grows when slots load, when the Confirm bar appears,
  // or when the viewport gets narrower — ResizeObserver catches all three.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      onHeightChange(Math.ceil(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);
  const [half, setHalf] = useState<Half>("all");
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Best-day drawer state. Lazy-loaded when the user clicks "Find best
  // day & time" so we don't spend a /week request on every panel mount.
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [dayOptions, setDayOptions] = useState<DayOption[]>([]);
  const [dayOptionsLoading, setDayOptionsLoading] = useState(false);
  const [dayOptionsError, setDayOptionsError] = useState<string | null>(null);

  const confirmDialog = useConfirm();

  const loadSlots = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/schedule/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId,
            half,
            day: selectedDay,
            offset: nextOffset,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? `Failed (${res.status})`);
          setSlots([]);
          setWarnings([]);
          setHasMore(false);
          return;
        }
        setSlots(json.slots ?? []);
        setWarnings(json.warnings ?? []);
        setHasMore(Boolean(json.hasMore));
      } catch (e) {
        setError((e as Error).message || "Network error");
      } finally {
        setLoading(false);
      }
    },
    [leadId, half, selectedDay]
  );

  // Reset to the first page whenever the context shifts — otherwise
  // switching halves or days shows "page 3 of yesterday" style staleness.
  useEffect(() => {
    setOffset(0);
  }, [half, selectedDay, leadId]);

  useEffect(() => {
    loadSlots(offset);
  }, [loadSlots, offset]);

  // Drop any preview when the half-day filter changes. Otherwise the
  // "Confirm & book 2:00 PM" bar would still sit under a list that no
  // longer includes that slot (e.g. filtered to AM) and the map would
  // keep drawing the stale amber overlay.
  useEffect(() => {
    onPreview(null);
    // Intentionally only reacting to `half`. onPreview is a stable setter
    // and including it would clear the preview on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [half]);

  async function loadDayOptions() {
    setDayOptionsLoading(true);
    setDayOptionsError(null);
    try {
      const res = await fetch("/api/schedule/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, horizonDays: 14 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDayOptionsError(json.error ?? `Failed (${res.status})`);
        setDayOptions([]);
        return;
      }
      const rawDays = (json.days ?? []) as Array<
        | {
            date: string;
            isWorkDay: true;
            bestTotalDriveMinutes: number | null;
            clusterBonusMinutes: number;
            effectiveBestMinutes: number | null;
            slotCount: number;
          }
        | { date: string; isWorkDay: false }
      >;
      const ranked: DayOption[] = rawDays
        .filter(
          (
            d
          ): d is Extract<(typeof rawDays)[number], { isWorkDay: true }> =>
            d.isWorkDay
        )
        .filter((d) => d.slotCount > 0 && d.effectiveBestMinutes !== null)
        .sort((a, b) => {
          const av = a.effectiveBestMinutes ?? Number.POSITIVE_INFINITY;
          const bv = b.effectiveBestMinutes ?? Number.POSITIVE_INFINITY;
          return av - bv;
        })
        .slice(0, 5)
        .map((d) => ({
          date: d.date,
          bestTotalDriveMinutes: d.bestTotalDriveMinutes,
          effectiveBestMinutes: d.effectiveBestMinutes,
          slotCount: d.slotCount,
          clusterBonusMinutes: d.clusterBonusMinutes,
        }));
      setDayOptions(ranked);
    } catch (e) {
      setDayOptionsError((e as Error).message || "Network error");
    } finally {
      setDayOptionsLoading(false);
    }
  }

  function toggleDayPicker() {
    const nextOpen = !dayPickerOpen;
    setDayPickerOpen(nextOpen);
    if (nextOpen && dayOptions.length === 0 && !dayOptionsLoading) {
      loadDayOptions();
    }
  }

  async function book() {
    if (!previewSlot) return;
    setBooking(true);
    setError(null);
    try {
      const patchRes = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_time: previewSlot.startTime,
          scheduled_day: selectedDay,
          // Booking a specific time clears any pending flex window so the
          // route map treats it as a pinned appointment again.
          flex_window: null,
        }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) {
        throw new Error(patchJson.error ?? "Failed to set time");
      }
      const calRes = await fetch(`/api/leads/${leadId}/calendar`, { method: "POST" });
      const calJson = await calRes.json();
      if (await handleCalendarDisconnected(calRes, calJson, confirmDialog)) return;
      if (!calRes.ok) throw new Error(calJson.error ?? "Calendar sync failed");
      onBooked(`Booked ${leadLabel} at ${formatClock(previewSlot.startTime)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  return (
    <div
      ref={panelRef}
      // Sit above the mobile BottomNav (z-40) so Confirm & book / Cancel
      // always stay tappable. On md+ the BottomNav is hidden, so the panel
      // returns to bottom-0.
      className="fixed inset-x-0 z-50 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:bottom-0 border-t border-[var(--border)] bg-white shadow-2xl rounded-t-2xl"
    >
      <div className="mx-auto max-w-6xl px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" /> Ranked slots
            </div>
            <div className="font-semibold truncate">
              {formatDateLong(selectedDay)}
            </div>
          </div>
          <HalfTabs half={half} setHalf={setHalf} />
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={toggleDayPicker}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs font-medium transition",
              dayPickerOpen
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
            )}
          >
            <CalendarSearch className="h-3.5 w-3.5" /> Find best day &amp; time
          </button>
          {hasMore || offset > 0 ? (
            <button
              type="button"
              onClick={() => setOffset((o) => (hasMore ? o + 1 : 0))}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 h-8 text-xs font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {hasMore ? "Show different times" : "Back to first page"}
            </button>
          ) : null}
        </div>

        {dayPickerOpen && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 space-y-1">
            {dayOptionsLoading ? (
              <div className="py-4 flex items-center justify-center text-xs text-[var(--muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Ranking days…
              </div>
            ) : dayOptionsError ? (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {dayOptionsError}
              </div>
            ) : dayOptions.length === 0 ? (
              <div className="py-3 text-center text-xs text-[var(--muted)]">
                No feasible days in the next two weeks.
              </div>
            ) : (
              dayOptions.map((d) => {
                const selected = d.date === selectedDay;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => {
                      onSelectDay(d.date);
                      setDayPickerOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition",
                      selected
                        ? "border-[var(--accent)] bg-white"
                        : "border-transparent bg-white hover:border-[var(--border)]"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {formatDateLong(d.date)}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {d.bestTotalDriveMinutes ?? "—"} min driving · {d.slotCount}{" "}
                        slot{d.slotCount === 1 ? "" : "s"}
                        {d.clusterBonusMinutes > 0
                          ? ` · clusters (-${d.clusterBonusMinutes}m)`
                          : ""}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                  </button>
                );
              })
            )}
          </div>
        )}

        {warnings.length > 0 && !loading && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {warnings.join(" · ")}
          </div>
        )}

        {error && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-6 flex items-center justify-center text-[var(--muted)] text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Ranking slots…
          </div>
        ) : slots.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--muted)]">
            No feasible slots on this day.
          </div>
        ) : (
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {slots.map((s) => {
              const selected = previewSlot?.startTime === s.startTime;
              return (
                <button
                  key={s.startTime}
                  onClick={() => onPreview(selected ? null : s)}
                  disabled={booking}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                    selected
                      ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
                      : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{formatClock(s.startTime)}</div>
                    <div className="text-xs text-[var(--muted)] truncate">
                      {[s.reasoning.priorLabel, s.reasoning.nextLabel]
                        .filter(Boolean)
                        .join(" · ") || "Open slot"}
                      {" · "}
                      {s.totalDriveMinutes} min driving
                    </div>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 transition",
                      selected
                        ? "text-amber-600 rotate-90"
                        : "text-[var(--muted)]"
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}

        {previewSlot && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onPreview(null)}
              disabled={booking}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-10 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={book}
              disabled={booking}
              className="flex-1 rounded-full bg-[var(--accent)] text-white h-10 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {booking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Booking…
                </>
              ) : (
                <>
                  <CalendarCheck className="h-4 w-4" />
                  Confirm &amp; book {formatClock(previewSlot.startTime)}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
