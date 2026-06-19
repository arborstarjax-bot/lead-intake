"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck,
  ChevronRight,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SlotPick = {
  date: string;
  startTime: string;
  driveMinutesBefore: number;
  driveMinutesAfter: number;
  totalDriveMinutes: number;
  reasoning: { priorLabel: string | null; nextLabel: string | null };
  insight?: string;
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
  const [picks, setPicks] = useState<SlotPick[]>([]);
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
        .slice(0, 2);

      if (days.length === 0) {
        setError("No feasible days in the next two weeks.");
        return;
      }

      // 2. Get top slots from the best 1-2 days
      const allPicks: SlotPick[] = [];
      for (const day of days) {
        if (cancelledRef.current) return;
        const slotRes = await fetch("/api/schedule/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, day: day.date, half: "all", offset: 0 }),
        });
        const slotJson = await slotRes.json();
        if (!slotRes.ok) continue;
        const slots = (slotJson.slots ?? []).slice(0, 2);
        for (const s of slots) {
          allPicks.push({
            date: day.date,
            startTime: s.startTime,
            driveMinutesBefore: s.driveMinutesBefore,
            driveMinutesAfter: s.driveMinutesAfter,
            totalDriveMinutes: s.totalDriveMinutes,
            reasoning: s.reasoning,
          });
        }
        if (allPicks.length >= 3) break;
      }

      if (cancelledRef.current) return;
      const top3 = allPicks.slice(0, 3);
      setPicks(top3);

      // 3. Fetch AI insights (non-blocking)
      if (top3.length > 0) {
        try {
          const insightRes = await fetch("/api/schedule/slot-insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slots: top3.map((s) => ({
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
            setPicks((prev) =>
              prev.map((p, i) => ({
                ...p,
                insight: insightJson.insights[i] ?? undefined,
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
      // Sync to calendar
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

  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)]">
          <Sparkles className="h-3.5 w-3.5" />
          Quick Schedule
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
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Finding best slots…
        </div>
      ) : error ? (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : picks.length === 0 ? (
        <div className="text-xs text-[var(--muted)] text-center py-3">
          No slots available. Try the full scheduler.
        </div>
      ) : (
        <div className="space-y-1.5">
          {picks.map((pick, i) => {
            const key = `${pick.date}-${pick.startTime}`;
            const isBooking = booking === key;
            const driveColor =
              pick.totalDriveMinutes <= 10
                ? "bg-emerald-100 text-emerald-700"
                : pick.totalDriveMinutes <= 20
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-600";
            return (
              <button
                key={key}
                type="button"
                onClick={() => bookSlot(pick)}
                disabled={booking !== null}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98]",
                  i === 0
                    ? "border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50"
                    : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"
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
                    {i === 0 && (
                      <span className="text-[9px] font-bold text-emerald-600 uppercase">
                        Best
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5 truncate">
                    {pick.insight ? (
                      <span className="text-[var(--accent)] font-medium">
                        {pick.insight}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">
                        {[pick.reasoning.priorLabel, pick.reasoning.nextLabel]
                          .filter(Boolean)
                          .join(" · ") || "Open slot"}
                      </span>
                    )}
                  </div>
                </div>
                {isBooking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--muted)] shrink-0" />
                ) : (
                  <CalendarCheck className="h-4 w-4 text-[var(--accent)] shrink-0" />
                )}
              </button>
            );
          })}
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
