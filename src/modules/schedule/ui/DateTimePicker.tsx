"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/SettingsProvider";
import type { ClientAppSettings } from "@/lib/client-settings";

// Ported from ArborCore's EstimateDateTimePicker: quick-day chips +
// month grid + 30-min time grid, honoring workspace work days/hours.

function getMonthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (number | null)[][] = [];
  let current = 1 - startDay;
  while (current <= daysInMonth) {
    const week: (number | null)[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(current >= 1 && current <= daysInMonth ? current : null);
      current++;
    }
    weeks.push(week);
  }
  return weeks;
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayIsoInTz(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function nowHHMMInTz(tz: string): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatClock(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mStr} ${ampm}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseHHMM(t: string): number {
  const m = t.match(/^(\d{2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

function timeSlots(settings: ClientAppSettings, emergency: boolean): string[] {
  const start = emergency ? 6 * 60 : parseHHMM(settings.work_start_time);
  const end = emergency ? 21 * 60 : parseHHMM(settings.work_end_time);
  const out: string[] = [];
  for (let m = start; m < end; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

export function DateTimePicker({
  day,
  time,
  emergency,
  onPickDay,
  onPickTime,
}: {
  day: string | null;
  time: string | null;
  /** Emergency mode: closed days + 6:00–21:00 become pickable. */
  emergency: boolean;
  onPickDay: (iso: string) => void;
  onPickTime: (hhmm: string) => void;
}) {
  const { settings } = useAppSettings();
  const tz = settings?.timezone ?? "America/New_York";
  const today = todayIsoInTz(tz);
  const workDays = useMemo(() => new Set(settings?.work_days ?? []), [settings]);

  const quickDays = useMemo(() => {
    const out: { iso: string; label: string }[] = [];
    const base = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = d.toLocaleDateString("en-CA", { timeZone: tz });
      const label =
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
      out.push({ iso, label });
    }
    return out;
  }, [tz]);

  const [calYear, setCalYear] = useState(() => {
    const src = day ?? today;
    return parseInt(src.split("-")[0], 10);
  });
  const [calMonth, setCalMonth] = useState(() => {
    const src = day ?? today;
    return parseInt(src.split("-")[1], 10) - 1;
  });

  const weeks = useMemo(() => getMonthGrid(calYear, calMonth), [calYear, calMonth]);
  const slots = useMemo(
    () => (settings ? timeSlots(settings, emergency) : []),
    [settings, emergency]
  );

  function navMonth(dir: -1 | 1) {
    let m = calMonth + dir;
    let y = calYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCalMonth(m);
    setCalYear(y);
  }

  const nowHHMM = nowHHMMInTz(tz);

  return (
    <div className="space-y-3">
      {/* Quick-day chips */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {quickDays.map((d) => {
          const active = day === d.iso;
          const closed = !workDays.has(new Date(d.iso + "T12:00:00").getDay());
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => onPickDay(d.iso)}
              disabled={closed && !emergency}
              className={cn(
                "shrink-0 snap-start rounded-full border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--fg)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)] hover:border-slate-400",
                closed && !emergency && "opacity-40 cursor-not-allowed"
              )}
            >
              {d.label}
              {closed && emergency && <span className="ml-1 text-[9px] text-amber-600">⚡</span>}
            </button>
          );
        })}
      </div>

      {/* Month grid */}
      <div className="rounded-xl border border-[var(--border)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <button aria-label="Previous month" type="button" onClick={() => navMonth(-1)} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{MONTH_NAMES[calMonth]} {calYear}</span>
          <button aria-label="Next month" type="button" onClick={() => navMonth(1)} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)]">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-[var(--muted)]">
          {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 text-center">
            {week.map((d, di) => {
              if (d === null) return <div key={di} />;
              const iso = isoOf(calYear, calMonth, d);
              const isSelected = iso === day;
              const isToday = iso === today;
              const isPast = iso < today;
              const closed = !workDays.has(new Date(iso + "T12:00:00").getDay());
              const disabled = isPast || (closed && !emergency);
              return (
                <button
                  key={di}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPickDay(iso)}
                  className={cn(
                    "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs transition",
                    isSelected
                      ? "bg-[var(--accent)] font-semibold text-white"
                      : isToday
                        ? "font-semibold text-[var(--accent)] ring-1 ring-inset ring-[var(--accent)]"
                        : disabled
                          ? "text-slate-300"
                          : closed && emergency
                            ? "text-amber-600 hover:bg-amber-50"
                            : "text-[var(--fg)] hover:bg-[var(--surface-2)]"
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Time grid */}
      {day && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-[var(--muted)]">Pick a time</span>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {slots.map((slot) => {
              const isPast = day === today && slot <= nowHHMM;
              const active = time === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  disabled={isPast}
                  onClick={() => onPickTime(slot)}
                  className={cn(
                    "rounded-full border px-2 py-1.5 text-xs font-medium transition",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--fg)]"
                      : "border-[var(--border)] bg-white text-[var(--fg)] hover:border-slate-400",
                    isPast && "opacity-40 cursor-not-allowed"
                  )}
                >
                  {formatClock(slot)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
