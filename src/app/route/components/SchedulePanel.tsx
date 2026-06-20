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
  type RouteResponse,
  type Slot,
  type Stop,
  type SmartBookingMode,
  type ScoredSlot,
  type SmartBookingResult,
} from "../route-helpers";

type Mode = "smart" | "manual" | "flex";

type DayOption = {
  date: string;
  bestTotalDriveMinutes: number | null;
  effectiveBestMinutes: number | null;
  slotCount: number;
  clusterBonusMinutes: number;
  routeScore: number;
};

// ── helpers ────────────────────────────────────────────────────────

function getDayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

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
  onHeightChange?: (h: number) => void;
  onBooked: (msg: string) => void;
  onSelectDay: (day: string) => void;
  onClose?: () => void;
  onReload?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { settings } = useAppSettings();
  const bufferMinutes = settings.min_time_between_appointments ?? 60;

  useEffect(() => {
    if (!onHeightChange) return;
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      onHeightChange(Math.ceil(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  const [mode, setMode] = useState<Mode>("smart");
  const smartMode: SmartBookingMode = "balanced";
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [smartResult, setSmartResult] = useState<SmartBookingResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const [bufferOverride, setBufferOverride] = useState(false);
  const [offHoursOverride, setOffHoursOverride] = useState(false);

  const [dayCardsLoading, setDayCardsLoading] = useState(false);
  const [dayCards, setDayCards] = useState<DayOption[]>([]);
  const dayStripRef = useRef<HTMLDivElement | null>(null);

  const [customTime, setCustomTime] = useState<string>("");
  const [flexWindow, setFlexWindow] = useState<LeadFlexWindow | null>(null);

  const requestIdRef = useRef(0);

  const stops = useMemo(() => routeData?.stops ?? [], [routeData]);

  const fixedTimeFeedback = useMemo(() => {
    if (mode !== "manual" || !customTime) return null;
    return getFixedTimeFeedback(customTime, stops);
  }, [mode, customTime, stops]);

  const fixedTimeViolation = useMemo(() => {
    if (mode !== "manual" || !customTime) return null;
    return getBufferViolation(customTime, stops, bufferMinutes);
  }, [mode, customTime, stops, bufferMinutes]);

  const offHoursWarning = useMemo(() => {
    if (mode !== "manual") return null;
    const workDays = settings.work_days ?? [1, 2, 3, 4, 5, 6];
    const workStart = settings.work_start_time ?? "08:00";
    const workEnd = settings.work_end_time ?? "17:00";
    const dayOfWeek = getDayOfWeek(selectedDay);
    const isNonWorkDay = !workDays.includes(dayOfWeek);
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    if (isNonWorkDay) {
      return `${dayNames[dayOfWeek]} is outside your configured work days.`;
    }
    if (customTime) {
      const timeMin = parseHHMM(customTime);
      const startMin = parseHHMM(workStart);
      const endMin = parseHHMM(workEnd);
      if (timeMin < startMin || timeMin >= endMin) {
        return `${formatClock(customTime)} is outside your work hours (${formatClock(workStart)} – ${formatClock(workEnd)}).`;
      }
    }
    return null;
  }, [mode, selectedDay, customTime, settings.work_days, settings.work_start_time, settings.work_end_time]);

  const loadSmartSlots = useCallback(
    async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/schedule/smart-book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId,
            mode: smartMode,
            day: selectedDay,
          }),
        });
        const json = await res.json();
        if (requestId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(json.error ?? `Failed (${res.status})`);
          setSmartResult(null);
          setSlots([]);
          setWarnings([]);
          return;
        }
        const result = json as SmartBookingResult;
        setSmartResult(result);
        // Convert scored slots to Slot type for booking compatibility
        setSlots(
          result.allSlots.map((s) => ({
            startTime: s.startTime,
            endTime: s.endTime,
            driveMinutesBefore: s.driveMinutesBefore,
            driveMinutesAfter: s.driveMinutesAfter,
            totalDriveMinutes: s.driveMinutesBefore + s.driveMinutesAfter,
            reasoning: s.reasoning,
          }))
        );
        setWarnings(result.warnings ?? []);
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        setError((e as Error).message || "Network error");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [leadId, smartMode, selectedDay]
  );

  useEffect(() => {
    if (mode === "smart") loadSmartSlots();
  }, [loadSmartSlots, mode]);

  useEffect(() => {
    onPreview(null);
    setCustomTime("");
    setFlexWindow(null);
    setError(null);
    setBufferOverride(false);
    setOffHoursOverride(false);
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
              routeScore: number;
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
            routeScore: d.routeScore ?? 50,
          }));
        if (!cancelled) {
          setDayCards(cards);
          // Auto-select best day if current day has no slots (e.g. today is a non-work day)
          if (cards.length > 0 && !cards.some((c) => c.date === selectedDay)) {
            onSelectDay(cards[0].date);
          }
        }
      } catch {
        // Silent — day cards just won't load
      } finally {
        if (!cancelled) setDayCardsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    mode === "flex" ? "purple" : mode === "manual" ? "blue" : "emerald";

  const stopCount = stops.length + (routeData?.flexStops?.length ?? 0);

  return (
    <div
      ref={panelRef}
      className="border-t border-[var(--border)] bg-white"
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

        {/* Booking mode tabs: Smart | Manual | Flex */}
        <div className="flex gap-1 rounded-xl bg-[var(--surface-2)] p-1">
          {(
            [
              { key: "smart", label: "Smart Booking", icon: <Sparkles className="h-3.5 w-3.5" /> },
              { key: "manual", label: "Manual", icon: <CalendarCheck className="h-3.5 w-3.5" /> },
              { key: "flex", label: "Flex", icon: <Sun className="h-3.5 w-3.5" /> },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                mode === tab.key
                  ? "bg-white text-[var(--fg)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Route context — compact summary with route score */}
        {stops.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--muted)]">
            <Car className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">{stopCount} estimate{stopCount !== 1 ? "s" : ""}</span>
            {routeData?.totalDriveMinutes != null && (
              <span>· {routeData.totalDriveMinutes}m drive</span>
            )}
            {(() => {
              const activeDay = dayCards.find((d) => d.date === selectedDay);
              if (!activeDay) return null;
              const rs = activeDay.routeScore;
              const rsColor = rs >= 80 ? "text-emerald-600" : rs >= 60 ? "text-amber-600" : "text-red-500";
              return <span className={cn("font-semibold", rsColor)}>· Route {rs}</span>;
            })()}
          </div>
        )}

        {/* Smart Booking mode */}
        {mode === "smart" && (
          <>
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
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Scoring slots…
              </div>
            ) : (
              <SmartSlotList
                smartResult={smartResult}
                bestOverallTime={smartResult?.bestOverall?.startTime ?? null}
                previewSlot={previewSlot}
                booking={booking}
                slots={slots}
                stops={stops}
                onPreview={onPreview}
              />
            )}
          </>
        )}

        {/* Manual Booking mode */}
        {mode === "manual" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="time"
                value={customTime}
                onChange={(e) => {
                  setCustomTime(e.target.value);
                  setBufferOverride(false);
                  setOffHoursOverride(false);
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

            {/* Off-hours / non-work-day warning */}
            {offHoursWarning && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">{offHoursWarning}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={offHoursOverride}
                    onChange={(e) => setOffHoursOverride(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-xs font-medium text-amber-800">
                    I understand — schedule anyway
                  </span>
                </label>
              </div>
            )}

            {/* Route warning with Smart Booking recommendation */}
            {customTime && fixedTimeFeedback && fixedTimeFeedback.color.includes("amber") && smartResult?.bestOverall && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                <p className="text-xs text-blue-800">
                  <AlertTriangle className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                  This time is available, but may create a long drive or isolated estimate.{" "}
                  <strong>Smart Booking recommends {formatDayShort(smartResult.bestOverall.date)} at {formatClock(smartResult.bestOverall.startTime)}</strong> instead.
                </p>
              </div>
            )}

            <p className="text-[11px] text-[var(--muted)]">
              Pick any time — conflicts are blocked, but poor route choices are allowed with a warning.
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
            {/* Optional Smart Booking recommendation */}
            {smartResult?.bestOverall && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                <p className="text-xs text-blue-800">
                  <Sparkles className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                  Smart Booking suggests <strong>{formatDayShort(smartResult.bestOverall.date)} at {formatClock(smartResult.bestOverall.startTime)}</strong> (score {smartResult.bestOverall.scores.finalScore}).
                </p>
              </div>
            )}
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
              disabled={booking || (mode === "manual" && ((!!fixedTimeViolation && !bufferOverride) || (!!offHoursWarning && !offHoursOverride)))}
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

// ── Smart Slot List (flat list with Top Pick badge + Show More) ────

function SmartSlotList({
  smartResult,
  bestOverallTime,
  previewSlot,
  booking,
  slots,
  stops,
  onPreview,
}: {
  smartResult: SmartBookingResult | null;
  bestOverallTime: string | null;
  previewSlot: Slot | null;
  booking: boolean;
  slots: Slot[];
  stops: Stop[];
  onPreview: (slot: Slot | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!smartResult || smartResult.allSlots.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-[var(--muted)]">
        No feasible slots on this day.
      </div>
    );
  }

  const { morningTop3, afternoonTop3, allSlots } = smartResult;

  const morningVisible = expanded ? morningTop3 : morningTop3.slice(0, 3);
  const afternoonVisible = expanded ? afternoonTop3 : afternoonTop3.slice(0, 3);
  const visibleCount = morningVisible.length + afternoonVisible.length;
  const totalCount = morningTop3.length + afternoonTop3.length;
  const hiddenCount = totalCount - visibleCount;
  const allHidden = allSlots.length - totalCount;

  return (
    <div className="space-y-3">
      {/* Morning */}
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1.5">
          <Sunrise className="h-3 w-3" />
          Morning
        </div>
        {morningVisible.length === 0 ? (
          <div className="text-[11px] text-[var(--muted)] bg-[var(--surface-2)] rounded-lg px-3 py-2 text-center border border-dashed border-[var(--border)]">
            No morning slots
          </div>
        ) : (
          <div className="space-y-1.5">
            {morningVisible.map((s) => (
              <ScoredSlotCard
                key={s.startTime}
                slot={s}
                isTopPick={s.startTime === bestOverallTime}
                selected={previewSlot?.startTime === s.startTime}
                disabled={booking}
                onSelect={() => {
                  const sl = slots.find((x) => x.startTime === s.startTime);
                  if (sl) onPreview(previewSlot?.startTime === sl.startTime ? null : sl);
                }}
                stops={stops}
              />
            ))}
          </div>
        )}
      </div>

      {/* Afternoon */}
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1.5">
          <Sunset className="h-3 w-3" />
          Afternoon
        </div>
        {afternoonVisible.length === 0 ? (
          <div className="text-[11px] text-[var(--muted)] bg-[var(--surface-2)] rounded-lg px-3 py-2 text-center border border-dashed border-[var(--border)]">
            No afternoon slots
          </div>
        ) : (
          <div className="space-y-1.5">
            {afternoonVisible.map((s) => (
              <ScoredSlotCard
                key={s.startTime}
                slot={s}
                isTopPick={s.startTime === bestOverallTime}
                selected={previewSlot?.startTime === s.startTime}
                disabled={booking}
                onSelect={() => {
                  const sl = slots.find((x) => x.startTime === s.startTime);
                  if (sl) onPreview(previewSlot?.startTime === sl.startTime ? null : sl);
                }}
                stops={stops}
              />
            ))}
          </div>
        )}
      </div>

      {/* Show more button */}
      {!expanded && (hiddenCount > 0 || allHidden > 0) && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--accent)] transition"
        >
          Show {hiddenCount + allHidden} more time{(hiddenCount + allHidden) !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

// ── Scored Slot Card (Smart Booking) ───────────────────────────────

function ScoredSlotCard({
  slot,
  isTopPick,
  selected,
  disabled,
  onSelect,
  stops,
}: {
  slot: ScoredSlot;
  isTopPick: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  stops: Stop[];
}) {
  const scoreColor =
    slot.scores.finalScore >= 75
      ? "bg-emerald-100 text-emerald-700"
      : slot.scores.finalScore >= 50
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600";

  const driveLabel = slot.extraDriveMinutes > 0
    ? `+${slot.extraDriveMinutes}m`
    : "0m";

  const miniSlot: Slot = {
    startTime: slot.startTime,
    endTime: slot.endTime,
    driveMinutesBefore: slot.driveMinutesBefore,
    driveMinutesAfter: slot.driveMinutesAfter,
    totalDriveMinutes: slot.driveMinutesBefore + slot.driveMinutesAfter,
    reasoning: slot.reasoning,
  };
  const miniRoute = buildMiniRoute(miniSlot, stops);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
        selected
          ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
          : isTopPick
            ? "border-emerald-400 bg-emerald-50/60"
            : "border-[var(--border)] bg-white hover:bg-slate-50"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold leading-none">
              {formatClock(slot.startTime)}
            </span>
            {isTopPick && (
              <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-100 rounded px-1.5 py-0.5">
                Top Pick
              </span>
            )}
            <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5", scoreColor)}>
              {slot.scores.finalScore}
            </span>
            <span className="text-[10px] text-[var(--muted)]">
              {driveLabel}
            </span>
          </div>
          {slot.explanation && (
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              {slot.explanation}
            </div>
          )}
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 transition",
            selected ? "text-emerald-600 rotate-90" : "text-[var(--muted)]"
          )}
        />
      </div>

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
