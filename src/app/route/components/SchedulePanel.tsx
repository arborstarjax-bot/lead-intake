"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarSearch,
  Car,
  Check,
  ChevronRight,
  Clock,
  Home,
  List,
  Loader2,
  Map,
  Pin,
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
import { HalfTabs } from "./HalfTabs";

type Mode = "recommended" | "fixed" | "flex";
type RouteView = "list" | "map";

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
  const [half, setHalf] = useState<Half>("all");
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [routeView, setRouteView] = useState<RouteView>("list");
  const [bufferOverride, setBufferOverride] = useState(false);

  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [dayOptions, setDayOptions] = useState<DayOption[]>([]);
  const [dayOptionsLoading, setDayOptionsLoading] = useState(false);
  const [dayOptionsError, setDayOptionsError] = useState<string | null>(null);

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
  }, [half, selectedDay, leadId]);

  useEffect(() => {
    if (mode === "recommended") loadSlots(offset);
  }, [loadSlots, offset, mode]);

  useEffect(() => {
    onPreview(null);
    setCustomTime("");
    setFlexWindow(null);
    setError(null);
    setBufferOverride(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
        {/* Header */}
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

        {/* Day picker drawer */}
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

        {/* Color-coded mode toggle */}
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[var(--surface-2)] p-1">
          {(
            [
              { key: "recommended", label: "Recommended", icon: <Sparkles className="h-3.5 w-3.5" />, accent: "emerald" },
              { key: "fixed", label: "Fixed Time", icon: <Pin className="h-3.5 w-3.5" />, accent: "blue" },
              { key: "flex", label: "Flex Time", icon: <Clock className="h-3.5 w-3.5" />, accent: "purple" },
            ] as const
          ).map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-xl h-10 text-[12px] font-semibold transition",
                  active
                    ? m.accent === "emerald"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : m.accent === "blue"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-purple-600 text-white shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                )}
              >
                {m.icon}
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Route section with List/Map toggle */}
        {stops.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Today&apos;s Route · {stopCount} estimate{stopCount !== 1 ? "s" : ""}
              </div>
              <div className="inline-flex rounded-lg bg-white border border-[var(--border)] p-0.5">
                <button
                  type="button"
                  onClick={() => setRouteView("list")}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition",
                    routeView === "list"
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] hover:text-[var(--fg)]"
                  )}
                >
                  <List className="h-3 w-3" /> List
                </button>
                <button
                  type="button"
                  onClick={() => setRouteView("map")}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition",
                    routeView === "map"
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] hover:text-[var(--fg)]"
                  )}
                >
                  <Map className="h-3 w-3" /> Map
                </button>
              </div>
            </div>

            {routeView === "list" ? (
              <RouteListView
                stops={stops}
                home={routeData?.home ?? null}
                totalDriveMinutes={routeData?.totalDriveMinutes ?? null}
                compact={mode !== "recommended"}
              />
            ) : (
              <div className="px-3 pb-2">
                <div className="text-xs text-[var(--muted)] text-center py-4">
                  Map view available on the Route page above
                </div>
              </div>
            )}
          </div>
        )}

        {/* Recommended mode */}
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
                {slots.map((s, i) => (
                  <SmartSlotCard
                    key={s.startTime}
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
                  />
                ))}
              </div>
            )}
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

// ── Route List View ────────────────────────────────────────────────

function RouteListView({
  stops,
  home,
  totalDriveMinutes,
  compact,
}: {
  stops: Stop[];
  home: RouteResponse["home"];
  totalDriveMinutes: number | null;
  compact: boolean;
}) {
  if (stops.length === 0) {
    return (
      <div className="px-3 pb-3 text-xs text-[var(--muted)] text-center py-3">
        No estimates scheduled for this day yet.
      </div>
    );
  }

  return (
    <div className={cn("px-3 pb-3", compact ? "max-h-[18vh] overflow-y-auto" : "max-h-[22vh] overflow-y-auto")}>
      {/* Home base start */}
      {home && (
        <div className="flex items-center gap-2 py-1.5">
          <div className="flex items-center justify-center h-6 w-6 rounded-full bg-slate-200">
            <Home className="h-3 w-3 text-slate-600" />
          </div>
          <span className="text-[11px] text-[var(--muted)] font-medium">
            Home base
          </span>
        </div>
      )}

      {stops.map((stop, idx) => (
        <div key={stop.id}>
          {/* Drive connector */}
          {(idx > 0 || home) && stop.driveMinutesFromPrev != null && (
            <div className="flex items-center gap-2 pl-3 py-0.5">
              <div className="w-px h-4 bg-slate-300" />
              <div className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                <Car className="h-2.5 w-2.5" />
                {stop.driveMinutesFromPrev} min
                {stop.distanceMilesFromPrev != null && stop.distanceMilesFromPrev > 0 && (
                  <> · {stop.distanceMilesFromPrev} mi</>
                )}
              </div>
            </div>
          )}
          {/* Stop row */}
          <div className="flex items-center gap-2 py-1.5">
            <div className={cn(
              "flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold text-white shrink-0",
              "bg-blue-600"
            )}>
              {idx + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={cn("font-semibold truncate", compact ? "text-[11px]" : "text-xs")}>
                  {stop.label}
                </span>
                <span className={cn("font-bold shrink-0", compact ? "text-[11px]" : "text-xs")}>
                  {formatClock(stop.startTime)}
                </span>
              </div>
              {!compact && (
                <div className="text-[10px] text-[var(--muted)] truncate">
                  {stop.address}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Home base return */}
      {home && (
        <>
          {stops.length > 0 && routeData_returnDrive(stops) && (
            <div className="flex items-center gap-2 pl-3 py-0.5">
              <div className="w-px h-4 bg-slate-300" />
              <div className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                <Car className="h-2.5 w-2.5" /> return
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 py-1.5">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-slate-200">
              <Home className="h-3 w-3 text-slate-600" />
            </div>
            <span className="text-[11px] text-[var(--muted)] font-medium">
              Home base
            </span>
          </div>
        </>
      )}

      {/* Stats */}
      <div className="flex items-center gap-2 pt-1 text-[10px] text-[var(--muted)]">
        {stops.length} estimate{stops.length !== 1 ? "s" : ""}
        {totalDriveMinutes != null && <> · {totalDriveMinutes}m total drive</>}
      </div>
    </div>
  );
}

function routeData_returnDrive(stops: Stop[]): boolean {
  return stops.length > 0;
}

// ── Smart Slot Card ────────────────────────────────────────────────

function SmartSlotCard({
  slot,
  isBest,
  selected,
  disabled,
  onSelect,
  stops,
}: {
  slot: Slot;
  isBest: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  stops: Stop[];
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
          <div className="text-[11px] text-[var(--muted)] mt-1 truncate">
            {[slot.reasoning.priorLabel, slot.reasoning.nextLabel]
              .filter(Boolean)
              .join(" · ") || "Open slot"}
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
