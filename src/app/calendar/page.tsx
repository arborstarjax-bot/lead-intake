"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import type { Lead } from "@/lib/types";

/**
 * In-app month calendar. Shows a single month at a time with booked
 * estimate counts per day. Tapping a day deep-links to `/route?day=` so
 * the user can manage that day's stops. Data source is `/api/leads` —
 * we filter client-side by scheduled_day so this page doesn't need a
 * new API endpoint. Keep it simple: read-only view for now, drag-to-
 * reschedule is a future extension.
 */
export default function CalendarPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  useEffect(() => {
    setLoading(true);
    fetch("/api/leads?view=all")
      .then((r) => r.json())
      .then((j) => {
        setLeads(Array.isArray(j.leads) ? j.leads : []);
      })
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, []);

  const todayIso = useMemo(() => toIso(new Date()), []);
  const grid = useMemo(() => buildMonthGrid(anchor.year, anchor.month), [anchor]);
  const leadsByDay = useMemo(() => {
    const byDay = new Map<string, Lead[]>();
    for (const l of leads) {
      if (!l.scheduled_day) continue;
      if (l.status === "Completed" || l.status === "Lost") continue;
      const arr = byDay.get(l.scheduled_day) ?? [];
      arr.push(l);
      byDay.set(l.scheduled_day, arr);
    }
    return byDay;
  }, [leads]);

  const totalBooked = useMemo(() => {
    let count = 0;
    for (const day of grid) {
      if (day.inMonth) count += leadsByDay.get(day.iso)?.length ?? 0;
    }
    return count;
  }, [grid, leadsByDay]);

  function shiftMonth(delta: -1 | 1) {
    setAnchor((prev) => {
      const d = new Date(Date.UTC(prev.year, prev.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  const monthLabel = new Date(Date.UTC(anchor.year, anchor.month, 1))
    .toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" aria-label="Home" className="inline-flex items-center">
          <Logo variant="mark" size="sm" />
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Calendar</h1>
        <div className="w-9" />
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-center">
            <div className="font-semibold">{monthLabel}</div>
            <div className="text-[11px] text-[var(--muted)]">
              {loading
                ? "Loading…"
                : totalBooked === 0
                  ? "No booked estimates this month"
                  : `${totalBooked} booked estimate${totalBooked === 1 ? "" : "s"}`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {grid.map((day) => {
            const dayLeads = leadsByDay.get(day.iso) ?? [];
            const count = dayLeads.length;
            const isToday = day.iso === todayIso;
            const active = count > 0 && day.inMonth;
            return (
              <DayCell
                key={day.iso}
                iso={day.iso}
                dayNum={day.dayNum}
                inMonth={day.inMonth}
                isToday={isToday}
                count={count}
                active={active}
                leads={dayLeads}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}

function DayCell({
  iso,
  dayNum,
  inMonth,
  isToday,
  count,
  active,
  leads,
}: {
  iso: string;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
  count: number;
  active: boolean;
  leads: Lead[];
}) {
  const preview = leads
    .slice(0, 2)
    .map((l) => l.client || "Untitled")
    .join(", ");
  const base = inMonth
    ? "bg-white"
    : "bg-[var(--surface-2)]/40 text-[var(--muted)]";
  return (
    <Link
      href={`/route?day=${iso}`}
      aria-label={`Open route for ${iso} — ${count} booked`}
      className={`group block aspect-square rounded-lg border border-[var(--border)] ${base} p-1.5 sm:p-2 hover:border-[var(--accent)] transition-colors`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] tabular-nums ${
            isToday
              ? "bg-[var(--accent)] text-white font-semibold"
              : inMonth
                ? "text-[var(--fg)]"
                : "text-[var(--muted)]"
          }`}
        >
          {dayNum}
        </span>
        {active && (
          <span className="inline-flex items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-semibold px-1.5 h-5 min-w-[1.25rem]">
            {count}
          </span>
        )}
      </div>
      {active && (
        <div className="mt-1 text-[10px] leading-tight text-[var(--muted)] truncate hidden sm:block">
          {preview}
          {leads.length > 2 && ` +${leads.length - 2}`}
        </div>
      )}
    </Link>
  );
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build a 6-row (42-cell) month grid starting from the Sunday on or
 * before the 1st. `inMonth=false` cells spill over into the prev/next
 * month and render in a muted style. Each cell is stamped with its ISO
 * date so booking lookup is a pure string key.
 */
function buildMonthGrid(
  year: number,
  month: number
): { iso: string; dayNum: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay(); // 0 = Sunday
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - firstWeekday);
  const cells: { iso: string; dayNum: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    cells.push({
      iso: `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      dayNum: day,
      inMonth: m === month,
    });
  }
  return cells;
}
