"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck,
  ChevronRight,
  Loader2,
  Sparkles,
  Sunrise,
  Sunset,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SlotInsight = { pro: string; con: string };

type SlotPick = {
  date: string;
  startTime: string;
  driveMinutesBefore: number;
  driveMinutesAfter: number;
  totalDriveMinutes: number;
  reasoning: { priorLabel: string | null; nextLabel: string | null };
  insight?: SlotInsight;
};

function formatClock(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${min} ${ampm}`;
}

function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = dt.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
  const month = dt.toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
  return `${weekday} ${month} ${d}`;
}

function todayIsoLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function currentHHMM(): string {
  const now = new Date();
  const parts = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return parts;
}

function isSlotPast(slot: SlotPick): boolean {
  const today = todayIsoLocal();
  if (slot.date > today) return false;
  if (slot.date < today) return true;
  return slot.startTime <= currentHHMM();
}

function parseHHMM(t: string): number {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function isMorning(startTime: string): boolean {
  return parseHHMM(startTime) < 720;
}

export function QuickScheduleInline({
  leadId,
  onBooked,
  onOpenFull,
  onClose,
}: {
  leadId: string;
  onBooked: (msg: string) => void;
  onOpenFull: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [amPicks, setAmPicks] = useState<SlotPick[]>([]);
  const [pmPicks, setPmPicks] = useState<SlotPick[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const loadPicks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Get best days
      const weekRes = await fetch("/api/schedule/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, horizonDays: 14 }),
      });
      const weekJson = await weekRes.json();
      if (!weekRes.ok) {
        setError(weekJson.error ?? "Failed to load days");
        return;
      }

      type DayPreview =
        | {
            date: string;
            isWorkDay: true;
            bestTotalDriveMinutes: number | null;
            effectiveBestMinutes: number | null;
            slotCount: number;
            clusterBonusMinutes: number;
          }
        | { date: string; isWorkDay: false };

      const days = ((weekJson.days ?? []) as DayPreview[])
        .filter(
          (d): d is Extract<DayPreview, { isWorkDay: true }> =>
            d.isWorkDay && d.slotCount > 0
        )
        .sort((a, b) => {
          const av = a.effectiveBestMinutes ?? Infinity;
          const bv = b.effectiveBestMinutes ?? Infinity;
          return av - bv;
        })
        .slice(0, 3);

      if (days.length === 0) {
        setError("No feasible days in the next two weeks.");
        return;
      }

      // 2. Get all slots from the best 1-3 days, then split AM/PM
      const allSlots: SlotPick[] = [];
      for (const day of days) {
        if (cancelledRef.current) return;
        const slotRes = await fetch("/api/schedule/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, day: day.date, half: "all", offset: 0 }),
        });
        const slotJson = await slotRes.json();
        if (!slotRes.ok) continue;
        for (const s of slotJson.slots ?? []) {
          allSlots.push({
            date: day.date,
            startTime: s.startTime,
            driveMinutesBefore: s.driveMinutesBefore,
            driveMinutesAfter: s.driveMinutesAfter,
            totalDriveMinutes: s.totalDriveMinutes,
            reasoning: s.reasoning,
          });
        }
      }

      if (cancelledRef.current) return;

      // Filter out past slots
      const future = allSlots.filter((s) => !isSlotPast(s));

      // Split AM/PM, take top 3 each (sorted by drive time)
      const am = future
        .filter((s) => isMorning(s.startTime))
        .sort((a, b) => a.totalDriveMinutes - b.totalDriveMinutes)
        .slice(0, 3);
      const pm = future
        .filter((s) => !isMorning(s.startTime))
        .sort((a, b) => a.totalDriveMinutes - b.totalDriveMinutes)
        .slice(0, 3);

      setAmPicks(am);
      setPmPicks(pm);

      // 3. Fetch AI insights for all picks (non-blocking)
      const allPicks = [...am, ...pm];
      if (allPicks.length > 0) {
        try {
          const insightRes = await fetch("/api/schedule/slot-insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slots: allPicks.map((s) => ({
                startTime: s.startTime,
                driveMinutesBefore: s.driveMinutesBefore,
                driveMinutesAfter: s.driveMinutesAfter,
                totalDriveMinutes: s.totalDriveMinutes,
                priorLabel: s.reasoning.priorLabel,
                nextLabel: s.reasoning.nextLabel,
              })),
              existingStopCount: 0,
              totalDayDriveMinutes: null,
              clusterBonusMinutes: 0,
            }),
          });
          const insightJson = await insightRes.json();
          if (!cancelledRef.current && Array.isArray(insightJson.insights)) {
            const insights = insightJson.insights;
            setAmPicks((prev) =>
              prev.map((p, i) => ({ ...p, insight: insights[i] ?? undefined }))
            );
            setPmPicks((prev) =>
              prev.map((p, i) => ({
                ...p,
                insight: insights[am.length + i] ?? undefined,
              }))
            );
          }
        } catch {
          // Non-fatal
        }
      }
    } catch (e) {
      if (!cancelledRef.current) {
        setError((e as Error).message || "Network error");
      }
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    cancelledRef.current = false;
    loadPicks();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadPicks]);

  async function bookSlot(pick: SlotPick) {
    const key = `${pick.date}-${pick.startTime}`;
    setBooking(key);
    setError(null);
    try {
      const patchRes = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_time: pick.startTime,
          scheduled_day: pick.date,
          flex_window: null,
          status: "Scheduled",
        }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) {
        setError(patchJson.error ?? "Booking failed");
        return;
      }
      await fetch(`/api/leads/${leadId}/calendar`, { method: "POST" });
      onBooked(
        `Booked ${formatDayShort(pick.date)} at ${formatClock(pick.startTime)}`
      );
    } catch (e) {
      setError((e as Error).message || "Booking failed");
    } finally {
      setBooking(null);
    }
  }

  const totalPicks = amPicks.length + pmPicks.length;
  // Determine global best slot across AM and PM
  const globalBest =
    totalPicks > 0
      ? [...amPicks, ...pmPicks].sort(
          (a, b) => a.totalDriveMinutes - b.totalDriveMinutes
        )[0]
      : null;

  function renderSlot(pick: SlotPick) {
    const key = `${pick.date}-${pick.startTime}`;
    const isBooking = booking === key;
    const isGlobalBest =
      globalBest &&
      pick.date === globalBest.date &&
      pick.startTime === globalBest.startTime;
    const driveColor =
      pick.totalDriveMinutes <= 10
        ? "bg-emerald-100 text-emerald-700"
        : pick.totalDriveMinutes <= 20
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600";
    const cardStyle = isGlobalBest
      ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200"
      : "border-[var(--border)] bg-white hover:bg-slate-50";
    return (
      <button
        key={key}
        type="button"
        onClick={() => bookSlot(pick)}
        disabled={booking !== null}
        className={cn(
          "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98]",
          cardStyle
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">
              {formatClock(pick.startTime)}
            </span>
            <span className="text-[10px] text-[var(--muted)]">
              {formatDayShort(pick.date)}
            </span>
            <span
              className={cn(
                "text-[10px] font-semibold rounded-full px-2 py-0.5",
                driveColor
              )}
            >
              +{pick.totalDriveMinutes}m
            </span>
            {isGlobalBest && (
              <span className="text-[9px] font-bold text-emerald-600 uppercase">
                Best
              </span>
            )}
          </div>
          {pick.insight && (pick.insight.pro || pick.insight.con) ? (
            <div className="mt-1 space-y-0.5 border-t border-slate-100 pt-1">
              {pick.insight.pro && (
                <div className="flex items-start gap-1 text-[11px] text-emerald-600">
                  <span className="font-bold shrink-0">+</span>
                  <span className="line-clamp-2">{pick.insight.pro}</span>
                </div>
              )}
              {pick.insight.con && (
                <div className="flex items-start gap-1 text-[11px] text-amber-600">
                  <span className="font-bold shrink-0">&minus;</span>
                  <span className="line-clamp-2">{pick.insight.con}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] mt-0.5 truncate text-[var(--muted)]">
              {[pick.reasoning.priorLabel, pick.reasoning.nextLabel]
                .filter(Boolean)
                .join(" · ") || "Open slot"}
            </div>
          )}
        </div>
        {isBooking ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)] shrink-0" />
        ) : (
          <CalendarCheck className="h-4 w-4 text-[var(--accent)] shrink-0" />
        )}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-slate-100 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)]">
          <Sparkles className="h-3.5 w-3.5" />
          AI Schedule Picks
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-[var(--muted)] hover:bg-white/60"
          aria-label="Close quick schedule"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Finding best cluster…
        </div>
      ) : error ? (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : totalPicks === 0 ? (
        <div className="text-xs text-[var(--muted)] text-center py-4">
          No good fits available. Try the full scheduler.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Morning section */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1.5">
              <Sunrise className="h-3 w-3" />
              Morning
            </div>
            {amPicks.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)] bg-white/60 rounded-lg px-3 py-2 text-center border border-dashed border-[var(--border)]">
                No morning slots available
              </div>
            ) : (
              <div className="space-y-1.5">
                {amPicks.map((pick) => renderSlot(pick))}
              </div>
            )}
          </div>

          {/* Afternoon section */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1.5">
              <Sunset className="h-3 w-3" />
              Afternoon
            </div>
            {pmPicks.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)] bg-white/60 rounded-lg px-3 py-2 text-center border border-dashed border-[var(--border)]">
                No afternoon slots available
              </div>
            ) : (
              <div className="space-y-1.5">
                {pmPicks.map((pick) => renderSlot(pick))}
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenFull}
        className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-[var(--accent)] hover:underline pt-1"
      >
        More options
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
