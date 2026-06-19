"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/SettingsProvider";
import { formatLeadPatchError, patchLead } from "@/modules/offline";
import {
  LEAD_FLEX_WINDOW_LABELS,
  type LeadFlexWindow,
} from "@/modules/leads/model";
import {
  formatClock,
  formatDateLong,
  type Half,
  type RouteResponse,
  type Slot,
  type Stop,
} from "../route-helpers";


type Mode = "recommended" | "fixed" | "flex";

type DayOption = {
  date: string;
  bestTotalDriveMinutes: number | null;
  effectiveBestMinutes: number | null;
  slotCount: number;
  clusterBonusMinutes: number;
};

// ── helpers ────────────────────────────────────────────────────────

function parseHHMM(t: string): number {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function formatTime(t: string): string {
  return formatClock(t);
}

function getBufferViolation(
  time: string,
  stops: Stop[],
  bufferMinutes: number
): { message: string } | null {
  const timeMin = parseHHMM(time);
  for (const stop of stops) {
    if (!stop.startTime) continue;
    const stopMin = parseHHMM(stop.startTime);
    const gap = Math.abs(timeMin - stopMin);
    if (gap > 0 && gap < bufferMinutes) {
      return {
        message: `Only ${gap} min between this and ${stop.label} (${formatTime(stop.startTime)}). Minimum buffer is ${bufferMinutes} min.`,
      };
    }
  }
  return null;
}

function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  const month = dt.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  return `${weekday} ${month} ${d}`;
}

function getFixedTimeFeedback(
  time: string,
  stops: Stop[]
): { label: string; color: string } | null {
  if (!time || stops.length === 0) return null;
  const timeMin = parseHHMM(time);
  let closestGap = Infinity;
  for (const stop of stops) {
    if (!stop.startTime) continue;
    const stopMin = parseHHMM(stop.startTime);
    const gap = Math.abs(timeMin - stopMin);
    if (gap > 0 && gap < closestGap) closestGap = gap;
  }
  if (closestGap === Infinity) return { label: "Open day — any time works", color: "text-emerald-600" };
  if (closestGap >= 90) return { label: "Good fit!", color: "text-emerald-600" };
  if (closestGap >= 45) return { label: "Reasonable gap", color: "text-emerald-600" };
  return { label: "Tight schedule", color: "text-amber-600" };
}

// ── Main Component ─────────────────────────────────────────────────

export function SchedulePanel({
  leadId,
  leadLabel,
  leadUpdatedAt,
  selectedDay,
  previewSlot,
  routeData,
  onPreview,
  onHeightChange,
  onBooked,
  onSelectDay,
  onClose,
  onReload,
}: {
  leadId: string;
  leadLabel: string;
  leadUpdatedAt: string | null;
  selectedDay: string;
  previewSlot: Slot | null;
  routeData: RouteResponse | null;
  onPreview: (slot: Slot | null) => void;
  onHeightChange: (h: number) => void;
  onBooked: (msg: string) => void;
  onSelectDay: (day: string) => void;
  onClose?: () => void;
  onReload?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { settings } = useAppSettings();
  const bufferMinutes = settings.min_time_between_appointments ?? 60;

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
  const half: Half = "all";
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [bufferOverride, setBufferOverride] = useState(false);

  const [dayCardsLoading, setDayCardsLoading] = useState(false);
  const [dayCards, setDayCards] = useState<DayOption[]>([]);
  const dayStripRef = useRef<HTMLDivElement | null>(null);
  const [slotInsights, setSlotInsights] = useState<string[]>([]);

  const [customTime, setCustomTime] = useState<string>("");
  const [flexWindow, setFlexWindow] = useState<LeadFlexWindow | null>(null);

  const requestIdRef = useRef(0);

  const stops = useMemo(() => routeData?.stops ?? [], [routeData]);

  const fixedTimeFeedback = useMemo(() => {
    if (mode !== "fixed" || !customTime) return null;
    return getFixedTimeFeedback(customTime, stops);
  }, [mode, customTime, stops]);

  const fixedTimeViolation = useMemo(() => {
    if (mode !== "fixed" || !customTime) return null;
    return getBufferViolation(customTime, stops, bufferMinutes);
  }, [mode, customTime, stops, bufferMinutes]);

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

  useEffect(() => {
    setOffset(0);
  }, [selectedDay, leadId]);

  useEffect(() => {
    if (mode === "recommended") loadSlots(offset);
  }, [loadSlots, offset, mode]);

  // Fetch AI insights for the current slot page (non-blocking)
  useEffect(() => {
    if (slots.length === 0) {
      setSlotInsights([]);
      return;
    }
    let cancelled = false;
    const activeDay = dayCards.find((d) => d.date === selectedDay);
    (async () => {
      try {
        const res = await fetch("/api/schedule/slot-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slots: slots.map((s) => ({
              startTime: s.startTime,
              driveMinutesBefore: s.driveMinutesBefore,
              driveMinutesAfter: s.driveMinutesAfter,
              totalDriveMinutes: s.totalDriveMinutes,
              priorLabel: s.reasoning.priorLabel,
              nextLabel: s.reasoning.nextLabel,
            })),
            existingStopCount: stops.length,
            totalDayDriveMinutes: routeData?.totalDriveMinutes ?? null,
            clusterBonusMinutes: activeDay?.clusterBonusMinutes ?? 0,
          }),
        });
        const json = await res.json();
        if (!cancelled && Array.isArray(json.insights)) {
          setSlotInsights(json.insights);
        }
      } catch {
        // Non-fatal — cards just won't show AI insights
      }
    })();
    return () => { cancelled = true; };
  }, [slots, stops.length, routeData?.totalDriveMinutes, selectedDay, dayCards]);

  useEffect(() => {
    onPreview(null);
    setCustomTime("");
    setFlexWindow(null);
    setError(null);
    setBufferOverride(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);



  // Auto-load day cards when scheduling opens
  useEffect(() => {
    let cancelled = false;
    setDayCardsLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/schedule/week", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, horizonDays: 14 }),
        });
        const json = await res.json();
        if (cancelled || !res.ok) return;
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
        const cards: DayOption[] = rawDays
          .filter(
            (d): d is Extract<(typeof rawDays)[number], { isWorkDay: true }> =>
              d.isWorkDay
          )
          .filter((d) => d.slotCount > 0)
          .sort((a, b) => {
            const av = a.effectiveBestMinutes ?? Number.POSITIVE_INFINITY;
            const bv = b.effectiveBestMinutes ?? Number.POSITIVE_INFINITY;
            return av - bv;
          })
          .map((d) => ({
            date: d.date,
            bestTotalDriveMinutes: d.bestTotalDriveMinutes,
            effectiveBestMinutes: d.effectiveBestMinutes,
            slotCount: d.slotCount,
            clusterBonusMinutes: d.clusterBonusMinutes,
          }));
        if (!cancelled) setDayCards(cards);
      } catch {
        // Silent — day cards just won't load
      } finally {
        if (!cancelled) setDayCardsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  function scrollDayStrip(dir: -1 | 1) {
    dayStripRef.current?.scrollBy({ left: dir * 120, behavior: "smooth" });
  }

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

  async function bookTime() {
    if (!previewSlot) return;
    setBooking(true);
    setError(null);
    try {
      const headers = bufferOverride ? { "x-allow-double-book": "1" } : undefined;
      const patchRes = await patchLead(
        leadId,
        {
          scheduled_time: previewSlot.startTime,
          scheduled_day: selectedDay,
          flex_window: null,
          status: "Scheduled",
        },
        { updated_at: leadUpdatedAt },
        headers
      );
      const patchJson = await patchRes.json();
      if (!patchRes.ok) {
        if (patchRes.status === 409 && patchJson.reason === "double_booking") {
          throw new Error(
            patchJson.error ??
              "That time slot is too close to another appointment. Enable the override checkbox to book anyway."
          );
        }
        if (patchRes.status === 409) onReload?.();
        throw new Error(formatLeadPatchError(patchRes, patchJson, "Failed to set time"));
      }
      const calRes = await fetch(`/api/leads/${leadId}/calendar`, { method: "POST" });
      const calJson = await calRes.json();
      if (calRes.status !== 428 && !calRes.ok) throw new Error(calJson.error ?? "Calendar sync failed");
      onBooked(`Booked ${leadLabel} at ${formatClock(previewSlot.startTime)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

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
          status: "Scheduled",
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

  const modeAccent =
    mode === "flex" ? "purple" : mode === "fixed" ? "blue" : "emerald";

  const stopCount = stops.length + (routeData?.flexStops?.length ?? 0);

  return (
    <div
      ref={panelRef}
      className="fixed inset-x-0 z-50 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:bottom-0 border-t border-[var(--border)] bg-white shadow-2xl rounded-t-2xl"
    >
      <div className="mx-auto max-w-6xl px-4 py-3 space-y-2">
        {/* Compact header — lead info + close */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
              <span className="font-semibold truncate">{leadLabel}</span>
            </div>
            {routeData?.ghost?.address && (
              <div className="text-[11px] text-[var(--muted)] truncate mt-0.5 pl-5">
                {routeData.ghost.address}
              </div>
            )}
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

        {/* Swipeable day cards */}
        <div className="flex items-center gap-1 -mx-1">
          <button
            type="button"
            onClick={() => scrollDayStrip(-1)}
            className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="Scroll days left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div
            ref={dayStripRef}
            className="flex-1 overflow-x-auto no-scrollbar"
          >
            <div className="inline-flex gap-1.5 py-0.5">
              {dayCardsLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ranking days…
                </div>
              ) : dayCards.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-[var(--muted)]">
                  {formatDateLong(selectedDay)}
                </div>
              ) : (
                dayCards.map((d, idx) => {
                  const active = d.date === selectedDay;
                  const bestEff = dayCards[0]?.effectiveBestMinutes ?? 0;
                  const thisEff = d.effectiveBestMinutes ?? Infinity;
                  const isBestDay = idx === 0;
                  const isGoodDay = !isBestDay && bestEff != null && thisEff <= bestEff + 5;
                  const tierColor = active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : isBestDay
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                      : isGoodDay
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]";
                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => onSelectDay(d.date)}
                      className={cn(
                        "shrink-0 flex flex-col items-center rounded-xl border px-3 py-1.5 text-center transition active:scale-[0.97]",
                        tierColor
                      )}
                    >
                      <span className="text-[11px] font-medium leading-tight">
                        {formatDayShort(d.date)}
                      </span>
                      <span className={cn("text-[10px] leading-tight mt-0.5", active ? "text-[var(--accent)]" : "text-[var(--muted)]")}>
                        {d.slotCount} slot{d.slotCount !== 1 ? "s" : ""}
                        {d.bestTotalDriveMinutes != null && ` · ${d.bestTotalDriveMinutes}m`}
                      </span>
                      {isBestDay && (
                        <span className="text-[9px] font-bold text-emerald-600 uppercase">Best</span>
                      )}
                      {isGoodDay && (
                        <span className="text-[9px] font-bold text-amber-600 uppercase">Good</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => scrollDayStrip(1)}
            className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
            aria-label="Scroll days right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Mode label when not in recommended mode */}
        {mode !== "recommended" && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
              {mode === "fixed" ? "Pick exact time" : "Set flex window"}
            </span>
            <button
              type="button"
              onClick={() => setMode("recommended")}
              className="text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              Back to best slots
            </button>
          </div>
        )}

        {/* Route context — compact summary instead of full list */}
        {stops.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--muted)]">
            <Car className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">{stopCount} estimate{stopCount !== 1 ? "s" : ""}</span>
            {routeData?.totalDriveMinutes != null && (
              <span>· {routeData.totalDriveMinutes}m total drive</span>
            )}
          </div>
        )}

        {/* Recommended mode */}
        {mode === "recommended" && (
          <>
            {(hasMore || offset > 0) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setOffset((o) => (hasMore ? o + 1 : 0))}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-white px-2.5 h-7 text-[11px] font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-60"
                >
                  <RefreshCw className="h-3 w-3" />
                  {hasMore ? "More times" : "First page"}
                </button>
              </div>
            )}

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
                {slots.map((s, i) => {
                  const hour = parseHHMM(s.startTime) / 60;
                  const prevHour = i > 0 ? parseHHMM(slots[i - 1].startTime) / 60 : 0;
                  const showMorning = i === 0 && hour < 12;
                  const showAfternoon = hour >= 12 && (i === 0 || prevHour < 12);
                  return (
                    <div key={s.startTime}>
                      {showMorning && slots.some((sl) => parseHHMM(sl.startTime) >= 720) && (
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] pb-1">
                          Morning
                        </div>
                      )}
                      {showAfternoon && (
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] pt-2 pb-1">
                          Afternoon
                        </div>
                      )}
                      <SmartSlotCard
                        slot={s}
                        isBest={i === 0 && offset === 0}
                        selected={previewSlot?.startTime === s.startTime}
                        disabled={booking}
                        onSelect={() =>
                          onPreview(
                            previewSlot?.startTime === s.startTime ? null : s
                          )
                        }
                        stops={stops}
                        insight={slotInsights[i] ?? null}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Power-user links */}
            <div className="flex items-center justify-center gap-3 pt-1 text-[11px]">
              <button
                type="button"
                onClick={() => setMode("fixed")}
                className="text-blue-600 font-medium hover:underline"
              >
                Pick exact time
              </button>
              <span className="text-[var(--muted)]">&middot;</span>
              <button
                type="button"
                onClick={() => setMode("flex")}
                className="text-purple-600 font-medium hover:underline"
              >
                Set flex window
              </button>
            </div>
          </>
        )}

        {/* Fixed time mode */}
        {mode === "fixed" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="time"
                value={customTime}
                onChange={(e) => {
                  setCustomTime(e.target.value);
                  setBufferOverride(false);
                  if (previewSlot) onPreview(null);
                }}
                step={300}
                className="field-input h-11 text-base font-semibold max-w-[10rem]"
                aria-label="Fixed appointment time"
              />
              <button
                type="button"
                onClick={previewFixed}
                disabled={!customTime || booking}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 text-white px-4 h-11 text-sm font-semibold disabled:opacity-60"
              >
                Preview {customTime ? formatClock(customTime) : "time"}
              </button>
            </div>

            {/* Live feedback */}
            {fixedTimeFeedback && customTime && (
              <div className={cn("text-sm font-medium flex items-center gap-1.5", fixedTimeFeedback.color)}>
                {fixedTimeFeedback.color.includes("emerald") ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                {fixedTimeFeedback.label}
              </div>
            )}

            {/* Buffer violation warning */}
            {fixedTimeViolation && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">{fixedTimeViolation.message}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bufferOverride}
                    onChange={(e) => setBufferOverride(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs font-medium text-amber-800">
                    Book anyway — override buffer requirement
                  </span>
                </label>
              </div>
            )}

            <p className="text-[11px] text-[var(--muted)]">
              Bypasses drive-time optimization — use when the time has
              already been agreed with the customer.
            </p>
            {error && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Flex mode */}
        {mode === "flex" && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: "all_day", label: "All Day", sub: "7 AM – 5 PM", icon: <Sun className="h-5 w-5" /> },
                  { key: "am", label: "Morning", sub: "7 AM – 12 PM", icon: <Sunrise className="h-5 w-5" /> },
                  { key: "pm", label: "Afternoon", sub: "12 PM – 5 PM", icon: <Sunset className="h-5 w-5" /> },
                ] as const
              ).map((opt) => {
                const active = flexWindow === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setFlexWindow(flexWindow === opt.key ? null : opt.key)
                    }
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center transition active:scale-[0.98]",
                      active
                        ? "border-purple-500 bg-purple-50 text-purple-700 ring-2 ring-purple-200"
                        : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
                    )}
                  >
                    {opt.icon}
                    <span className="text-sm font-semibold">{opt.label}</span>
                    <span className="text-[10px] text-[var(--muted)]">{opt.sub}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              The route optimizer assigns the best time when you build the day.
            </p>
            {error && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}
          </>
        )}

        {/* Confirm bar */}
        {canConfirm && confirmLabel && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => {
                onPreview(null);
                setFlexWindow(null);
              }}
              disabled={booking}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-12 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={booking || (mode === "fixed" && !!fixedTimeViolation && !bufferOverride)}
              className={cn(
                "flex-1 rounded-full h-12 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60",
                modeAccent === "emerald"
                  ? "bg-emerald-600 text-white"
                  : modeAccent === "blue"
                    ? "bg-blue-600 text-white"
                    : "bg-purple-600 text-white"
              )}
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

// ── Smart Slot Card ────────────────────────────────────────────────

function SmartSlotCard({
  slot,
  isBest,
  selected,
  disabled,
  onSelect,
  stops,
  insight,
}: {
  slot: Slot;
  isBest: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  stops: Stop[];
  insight: string | null;
}) {
  const driveLabel = `+${slot.totalDriveMinutes} min`;
  const driveColor =
    slot.totalDriveMinutes <= 10
      ? "bg-emerald-100 text-emerald-700"
      : slot.totalDriveMinutes <= 20
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600";

  const miniRoute = buildMiniRoute(slot, stops);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] relative overflow-hidden",
        selected
          ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
          : isBest
            ? "border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50"
            : slot.totalDriveMinutes <= 20
              ? "border-amber-200 bg-amber-50/30 hover:bg-amber-50/50"
              : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"
      )}
    >
      {isBest && (
        <div className="absolute top-0 left-0 right-0 bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-wider text-center py-0.5">
          Best Match
        </div>
      )}
      <div className={cn("flex items-center justify-between gap-2", isBest && "pt-3")}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold leading-none">
              {formatClock(slot.startTime)}
            </span>
            <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5", driveColor)}>
              {driveLabel}
            </span>
          </div>
          <div className="text-[11px] mt-1 truncate">
            {insight ? (
              <span className="text-[var(--accent)] font-medium">{insight}</span>
            ) : (
              <span className="text-[var(--muted)]">
                {[slot.reasoning.priorLabel, slot.reasoning.nextLabel]
                  .filter(Boolean)
                  .join(" · ") || "Open slot"}
              </span>
            )}
          </div>
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 transition",
            selected ? "text-emerald-600 rotate-90" : "text-[var(--muted)]"
          )}
        />
      </div>

      {/* Mini route diagram */}
      {miniRoute.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-[var(--muted)] overflow-x-auto">
          {miniRoute.map((seg, i) => (
            <span key={i} className="flex items-center gap-0.5 shrink-0 whitespace-nowrap">
              {seg.type === "star" ? (
                <span className="font-bold text-emerald-600">★ New</span>
              ) : seg.type === "stop" ? (
                <span className="truncate max-w-[5rem]">{seg.label}</span>
              ) : (
                <span className="text-[9px] text-slate-400">→ {seg.label} →</span>
              )}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

type MiniSeg =
  | { type: "stop"; label: string }
  | { type: "drive"; label: string }
  | { type: "star" };

function buildMiniRoute(slot: Slot, stops: Stop[]): MiniSeg[] {
  if (stops.length === 0) return [];
  const slotMin = parseHHMM(slot.startTime);
  const segs: MiniSeg[] = [];

  const sorted = [...stops].sort(
    (a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime)
  );

  let inserted = false;
  for (let i = 0; i < sorted.length; i++) {
    const stopMin = parseHHMM(sorted[i].startTime);
    if (!inserted && slotMin <= stopMin) {
      if (segs.length > 0 && segs[segs.length - 1].type === "drive") {
        // Replace the trailing inter-stop drive with the drive-to-new-slot
        segs[segs.length - 1] = { type: "drive", label: `${slot.driveMinutesBefore}m` };
      } else if (segs.length > 0) {
        segs.push({ type: "drive", label: `${slot.driveMinutesBefore}m` });
      }
      segs.push({ type: "star" });
      segs.push({ type: "drive", label: `${slot.driveMinutesAfter}m` });
      inserted = true;
    }
    const name = sorted[i].label.split(/\s+/)[0] ?? sorted[i].label;
    segs.push({ type: "stop", label: name });
    if (i < sorted.length - 1 && sorted[i + 1].driveMinutesFromPrev != null) {
      segs.push({ type: "drive", label: `${sorted[i + 1].driveMinutesFromPrev}m` });
    }
  }
  if (!inserted) {
    if (segs.length > 0 && segs[segs.length - 1].type !== "drive") {
      segs.push({ type: "drive", label: `${slot.driveMinutesBefore}m` });
    } else if (segs.length > 0) {
      segs[segs.length - 1] = { type: "drive", label: `${slot.driveMinutesBefore}m` };
    }
    segs.push({ type: "star" });
  }

  // Keep it short — max 7 segments
  if (segs.length > 7) {
    return [...segs.slice(0, 3), { type: "drive", label: "…" }, ...segs.slice(-3)];
  }
  return segs;
}
