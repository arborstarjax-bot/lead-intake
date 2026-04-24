"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarCheck,
  CalendarSearch,
  ChevronRight,
  Clock,
  Loader2,
  Pin,
  RefreshCw,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatLeadPatchError, patchLead } from "@/modules/offline";
import {
  LEAD_FLEX_WINDOW_LABELS,
  type LeadFlexWindow,
} from "@/modules/leads/model";
import {
  formatClock,
  formatDateLong,
  handleCalendarDisconnected,
  type Half,
  type Slot,
} from "../route-helpers";
import { HalfTabs } from "./HalfTabs";

/**
 * Scheduling mode. The user asked for a single compact panel that lets
 * them switch between three workflows:
 *
 *   • "recommended" — rank feasible slots by drive time (the original
 *     "AI scheduling" behavior). Uses /api/schedule/suggest.
 *   • "fixed"       — pick any hh:mm manually. Bypasses the ranker; used
 *     when the appointment time has already been agreed with the
 *     customer and drive-time optimization isn't relevant.
 *   • "flex"        — flag the lead for a flex window (All day, AM, or
 *     PM) without pinning a specific time. The route optimizer assigns
 *     a time later when the day's stops are solved.
 *
 * All three modes share the top-level day picker, so a "reschedule"
 * flow is really just "change day + pick a mode + confirm". Keeping
 * the panel content one-mode-at-a-time is what lets us shrink the
 * overall height so the map underneath stays visible.
 */
type Mode = "recommended" | "fixed" | "flex";

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
  leadUpdatedAt,
  selectedDay,
  previewSlot,
  onPreview,
  onHeightChange,
  onBooked,
  onSelectDay,
  onClose,
  onReload,
}: {
  leadId: string;
  leadLabel: string;
  /** Ghost lead's `updated_at` at fetch time. Forwarded on the confirm
   *  PATCH so the server returns 409 if another writer moved the lead
   *  while the panel was open. */
  leadUpdatedAt: string | null;
  selectedDay: string;
  previewSlot: Slot | null;
  onPreview: (slot: Slot | null) => void;
  onHeightChange: (h: number) => void;
  onBooked: (msg: string) => void;
  /** Called when the user picks a different day (top-of-panel date
   *  input or the "Auto-pick best day" drawer). */
  onSelectDay: (day: string) => void;
  /** Called when the user dismisses the panel via the X. Closes the
   *  SchedulePanel so the map is fully visible again. */
  onClose?: () => void;
  /** Re-fetch the route data. Invoked when confirm returns a 409
   *  stale_write so the parent supplies a fresh `leadUpdatedAt` and
   *  the panel's next Confirm & book isn't doomed to re-409. */
  onReload?: () => void;
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

  const [mode, setMode] = useState<Mode>("recommended");
  const [half, setHalf] = useState<Half>("all");
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Best-day drawer state. Lazy-loaded when the user clicks "Auto-pick
  // best day" so we don't spend a /week request on every panel mount.
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [dayOptions, setDayOptions] = useState<DayOption[]>([]);
  const [dayOptionsLoading, setDayOptionsLoading] = useState(false);
  const [dayOptionsError, setDayOptionsError] = useState<string | null>(null);

  // Fixed-mode manual time entry. Kept separate from `previewSlot` so
  // typing in the input doesn't clobber a selected suggested slot (and
  // vice-versa when the user toggles modes).
  const [customTime, setCustomTime] = useState<string>("");

  // Flex-mode window selection. Local state (not previewSlot) because
  // the flex confirm path patches a different field set than the
  // slot-based path — it needs its own commit handler.
  const [flexWindow, setFlexWindow] = useState<LeadFlexWindow | null>(null);

  const confirmDialog = useConfirm();

  // Monotonic request ID for slot fetches. See the matching comment in
  // ScheduleModal for the same race + fix.
  const requestIdRef = useRef(0);

  const loadSlots = useCallback(
    async (nextOffset: number) => {
      const requestId = ++requestIdRef.current;
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
        if (requestId !== requestIdRef.current) return;
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
        if (requestId !== requestIdRef.current) return;
        setError((e as Error).message || "Network error");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [leadId, half, selectedDay]
  );

  // Reset to the first page whenever the context shifts — otherwise
  // switching halves or days shows "page 3 of yesterday" style staleness.
  useEffect(() => {
    setOffset(0);
  }, [half, selectedDay, leadId]);

  // Only fetch ranked slots when we're actually in recommended mode.
  // Fixed/Flex don't need them and fetching on every mode flip wastes
  // routing API quota.
  useEffect(() => {
    if (mode === "recommended") loadSlots(offset);
  }, [loadSlots, offset, mode]);

  // Clear in-flight selection state when the user switches modes.
  // The preview slot / custom time / flex window are mutually
  // exclusive, so only one should be "armed for confirm" at a time.
  useEffect(() => {
    onPreview(null);
    setCustomTime("");
    setFlexWindow(null);
    // Intentionally only reacting to `mode`. onPreview is a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Drop any recommended-mode preview when the half-day filter changes.
  // Otherwise the "Confirm & book 2:00 PM" bar would still sit under a
  // list that no longer includes that slot (e.g. filtered to AM) and
  // the map would keep drawing the stale amber overlay.
  useEffect(() => {
    if (mode === "recommended") onPreview(null);
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

  // Preview a manually-entered time. Synthesized slot has 0 drive
  // minutes because we haven't computed the actual impact of an
  // arbitrary user-picked time and guessing would mislead the UI.
  function previewFixed() {
    if (!customTime) return;
    onPreview({
      startTime: customTime,
      endTime: customTime,
      driveMinutesBefore: 0,
      driveMinutesAfter: 0,
      totalDriveMinutes: 0,
      reasoning: { priorLabel: null, nextLabel: "Fixed time" },
    });
  }

  // Shared commit path for recommended and fixed modes. Both flows
  // produce a `previewSlot` and both patch the same fields.
  async function bookTime() {
    if (!previewSlot) return;
    setBooking(true);
    setError(null);
    try {
      const patchRes = await patchLead(
        leadId,
        {
          scheduled_time: previewSlot.startTime,
          scheduled_day: selectedDay,
          // Booking a specific time clears any pending flex window so the
          // route map treats it as a pinned appointment again.
          flex_window: null,
        },
        { updated_at: leadUpdatedAt }
      );
      const patchJson = await patchRes.json();
      if (!patchRes.ok) {
        if (patchRes.status === 409 && patchJson.reason === "double_booking") {
          throw new Error(
            patchJson.error ??
              "That time slot is already booked by another lead. Pick a different time."
          );
        }
        if (patchRes.status === 409) onReload?.();
        throw new Error(formatLeadPatchError(patchRes, patchJson, "Failed to set time"));
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

  // Separate commit path for flex mode: the server treats flex_window
  // and scheduled_time as mutually exclusive (setting a flex window
  // wipes the time and vice-versa) — see the flex chips in LeadCard.
  // We don't sync a Google Calendar event because flex appointments
  // don't have a concrete start time; the calendar event is created
  // later when the route optimizer pins a real time.
  async function bookFlex() {
    if (!flexWindow) return;
    setBooking(true);
    setError(null);
    try {
      const patchRes = await patchLead(
        leadId,
        {
          scheduled_day: selectedDay,
          scheduled_time: null,
          flex_window: flexWindow,
        },
        { updated_at: leadUpdatedAt }
      );
      const patchJson = await patchRes.json();
      if (!patchRes.ok) {
        if (patchRes.status === 409) onReload?.();
        throw new Error(formatLeadPatchError(patchRes, patchJson, "Failed to set flex window"));
      }
      onBooked(
        `Scheduled ${leadLabel} for ${formatDateLong(selectedDay)} · ${LEAD_FLEX_WINDOW_LABELS[flexWindow]}`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  const confirmLabel = useMemo(() => {
    if (mode === "flex" && flexWindow) {
      return `Confirm · ${LEAD_FLEX_WINDOW_LABELS[flexWindow]}`;
    }
    if (previewSlot) {
      return `Confirm & book ${formatClock(previewSlot.startTime)}`;
    }
    return null;
  }, [mode, flexWindow, previewSlot]);

  const canConfirm = mode === "flex" ? Boolean(flexWindow) : Boolean(previewSlot);
  const onConfirm = mode === "flex" ? bookFlex : bookTime;

  return (
    <div
      ref={panelRef}
      // Sit above the mobile BottomNav (z-40) so Confirm & book / Cancel
      // always stay tappable. On md+ the BottomNav is hidden, so the panel
      // returns to bottom-0.
      className="fixed inset-x-0 z-50 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:bottom-0 border-t border-[var(--border)] bg-white shadow-2xl rounded-t-2xl"
    >
      <div className="mx-auto max-w-6xl px-4 py-3 space-y-2">
        {/* Header: lead label + inline date picker + close. Putting the
            date picker here (instead of inside a mode-specific panel)
            means reschedule-to-another-day is a single tap across all
            modes. */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
              Schedule {leadLabel}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="date"
                value={selectedDay}
                onChange={(e) => {
                  if (e.target.value) onSelectDay(e.target.value);
                }}
                className="field-input h-9 text-sm font-semibold max-w-[11rem]"
                aria-label="Appointment date"
              />
              <button
                type="button"
                onClick={toggleDayPicker}
                title="Auto-pick best day by drive time"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 h-8 text-[11px] font-medium transition",
                  dayPickerOpen
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-white text-[var(--muted)] hover:bg-[var(--surface-2)]"
                )}
              >
                <CalendarSearch className="h-3.5 w-3.5" /> Best day
              </button>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close schedule panel"
              className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {dayPickerOpen && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-2 space-y-1">
            {dayOptionsLoading ? (
              <div className="py-3 flex items-center justify-center text-xs text-[var(--muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Ranking days…
              </div>
            ) : dayOptionsError ? (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {dayOptionsError}
              </div>
            ) : dayOptions.length === 0 ? (
              <div className="py-2 text-center text-xs text-[var(--muted)]">
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

        {/* Mode toggle. Single row of 3 segmented buttons — keeps the
            panel at a consistent height regardless of which mode is
            active, and makes it obvious that these are alternatives
            (you pick ONE scheduling style per booking). */}
        <div className="grid grid-cols-3 gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          <ModeButton
            active={mode === "recommended"}
            onClick={() => setMode("recommended")}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="Recommended"
          />
          <ModeButton
            active={mode === "fixed"}
            onClick={() => setMode("fixed")}
            icon={<Pin className="h-3.5 w-3.5" />}
            label="Fixed Time"
          />
          <ModeButton
            active={mode === "flex"}
            onClick={() => setMode("flex")}
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Flex Time"
          />
        </div>

        {mode === "recommended" && (
          <>
            <div className="flex items-center justify-between gap-2">
              <HalfTabs half={half} setHalf={setHalf} />
              {hasMore || offset > 0 ? (
                <button
                  type="button"
                  onClick={() => setOffset((o) => (hasMore ? o + 1 : 0))}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-white px-2.5 h-7 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-60"
                >
                  <RefreshCw className="h-3 w-3" />
                  {hasMore ? "Different times" : "First page"}
                </button>
              ) : null}
            </div>

            {warnings.length > 0 && !loading && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {warnings.join(" · ")}
              </div>
            )}
            {error && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            {loading ? (
              <div className="py-4 flex items-center justify-center text-[var(--muted)] text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Ranking slots…
              </div>
            ) : slots.length === 0 ? (
              <div className="py-4 text-center text-sm text-[var(--muted)]">
                No feasible slots on this day.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[26vh] overflow-y-auto">
                {slots.map((s) => {
                  const selected = previewSlot?.startTime === s.startTime;
                  return (
                    <button
                      key={s.startTime}
                      onClick={() => onPreview(selected ? null : s)}
                      disabled={booking}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition active:scale-[0.99]",
                        selected
                          ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
                          : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-sm">{formatClock(s.startTime)}</div>
                        <div className="text-[11px] text-[var(--muted)] truncate">
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
          </>
        )}

        {mode === "fixed" && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="time"
              value={customTime}
              onChange={(e) => {
                setCustomTime(e.target.value);
                // Clear any previewed slot so the Confirm bar label
                // reflects the new time the user is typing, not the
                // previous one.
                if (previewSlot) onPreview(null);
              }}
              step={300}
              className="field-input h-9 text-sm max-w-[10rem]"
              aria-label="Fixed appointment time"
            />
            <button
              type="button"
              onClick={previewFixed}
              disabled={!customTime || booking}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] text-white px-3 h-9 text-xs font-semibold disabled:opacity-60"
            >
              Preview {customTime ? formatClock(customTime) : "time"}
            </button>
            <p className="text-[11px] text-[var(--muted)] basis-full">
              Bypasses drive-time optimization — use when the time has
              already been agreed with the customer.
            </p>
            {error && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 basis-full">
                {error}
              </div>
            )}
          </div>
        )}

        {mode === "flex" && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <FlexChip
                active={flexWindow === "all_day"}
                onClick={() => setFlexWindow(flexWindow === "all_day" ? null : "all_day")}
                icon={<Sun className="h-3.5 w-3.5" />}
                label="All Day"
              />
              <FlexChip
                active={flexWindow === "am"}
                onClick={() => setFlexWindow(flexWindow === "am" ? null : "am")}
                icon={<Sunrise className="h-3.5 w-3.5" />}
                label="AM"
              />
              <FlexChip
                active={flexWindow === "pm"}
                onClick={() => setFlexWindow(flexWindow === "pm" ? null : "pm")}
                icon={<Sunset className="h-3.5 w-3.5" />}
                label="PM"
              />
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              Puts the lead on this day without pinning a specific time —
              the route optimizer assigns one when you build the day.
            </p>
            {error && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}
          </>
        )}

        {canConfirm && confirmLabel && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => {
                onPreview(null);
                setFlexWindow(null);
              }}
              disabled={booking}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-10 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
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
                  {confirmLabel}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full h-8 text-[12px] font-semibold transition",
        active
          ? "bg-white text-[var(--fg)] shadow-sm"
          : "text-[var(--muted)] hover:text-[var(--fg)]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FlexChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 h-10 text-sm font-semibold transition active:scale-[0.98]",
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] ring-2 ring-[var(--accent)]/20"
          : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
