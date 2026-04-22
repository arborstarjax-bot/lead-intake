"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

type CalendarView = "month" | "week";

/**
 * In-app calendar. Two modes:
 *   • month  — 6-row grid, count bubble per day.
 *   • week   — 7-column agenda with an hour rail, each booked estimate
 *              rendered as a block sized to the default job duration.
 * Both read from the same `/api/leads` payload so the toggle is free —
 * no extra fetches. Tapping anywhere deep-links to `/route?day=` so the
 * user can manage that day's stops.
 */
export default function CalendarPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<CalendarView>("month");
  // Month view anchors on a (year, month). Week view anchors on the
  // Sunday of the visible week. We track the two independently so
  // flipping views keeps the user near where they were looking.
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [weekAnchorIso, setWeekAnchorIso] = useState(() =>
    toIso(startOfWeekLocal(new Date()))
  );

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
  const leadsByDay = useMemo(() => {
    const byDay = new Map<string, Lead[]>();
    for (const l of leads) {
      if (!l.scheduled_day) continue;
      if (l.status === "Completed" || l.status === "Lost") continue;
      const arr = byDay.get(l.scheduled_day) ?? [];
      arr.push(l);
      byDay.set(l.scheduled_day, arr);
    }
    // Order each day by scheduled_time for the week agenda blocks.
    for (const arr of byDay.values()) {
      arr.sort((a, b) => {
        const at = a.scheduled_time ?? "99:99";
        const bt = b.scheduled_time ?? "99:99";
        return at.localeCompare(bt);
      });
    }
    return byDay;
  }, [leads]);

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" aria-label="Home" className="inline-flex items-center">
          <Logo variant="mark" size="sm" />
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Calendar</h1>
        <div className="w-9" />
      </header>

      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-full border border-[var(--border)] bg-white p-1">
          {(["month", "week"] as CalendarView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                "px-4 h-8 rounded-full text-xs font-semibold capitalize transition-colors",
                view === v
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <MonthView
          anchor={monthAnchor}
          onShift={(delta) =>
            setMonthAnchor((prev) => {
              const d = new Date(Date.UTC(prev.year, prev.month + delta, 1));
              return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
            })
          }
          onPickDay={(iso) => {
            // Flipping to week view on a day-tap feels like an obvious
            // shortcut, but the existing behavior is "go to /route" — keep
            // that so a confident click still deep-links to stops. Week
            // toggle is an explicit action up top.
            void iso;
          }}
          todayIso={todayIso}
          leadsByDay={leadsByDay}
          loading={loading}
        />
      ) : (
        <WeekView
          anchorIso={weekAnchorIso}
          onShift={(delta) =>
            setWeekAnchorIso((prev) => shiftIsoByDays(prev, delta * 7))
          }
          onToday={() => setWeekAnchorIso(toIso(startOfWeekLocal(new Date())))}
          todayIso={todayIso}
          leadsByDay={leadsByDay}
          loading={loading}
        />
      )}
    </main>
  );
}

function MonthView({
  anchor,
  onShift,
  todayIso,
  leadsByDay,
  loading,
}: {
  anchor: { year: number; month: number };
  onShift: (delta: -1 | 1) => void;
  onPickDay: (iso: string) => void;
  todayIso: string;
  leadsByDay: Map<string, Lead[]>;
  loading: boolean;
}) {
  const grid = useMemo(
    () => buildMonthGrid(anchor.year, anchor.month),
    [anchor]
  );
  const totalBooked = useMemo(() => {
    let count = 0;
    for (const day of grid) {
      if (day.inMonth) count += leadsByDay.get(day.iso)?.length ?? 0;
    }
    return count;
  }, [grid, leadsByDay]);
  const monthLabel = new Date(Date.UTC(anchor.year, anchor.month, 1))
    .toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onShift(-1)}
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
          onClick={() => onShift(1)}
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
  );
}

function WeekView({
  anchorIso,
  onShift,
  onToday,
  todayIso,
  leadsByDay,
  loading,
}: {
  anchorIso: string;
  onShift: (delta: -1 | 1) => void;
  onToday: () => void;
  todayIso: string;
  leadsByDay: Map<string, Lead[]>;
  loading: boolean;
}) {
  const days = useMemo(() => {
    const out: { iso: string; dayNum: number; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = shiftIsoByDays(anchorIso, i);
      const d = parseIsoLocal(iso);
      out.push({
        iso,
        dayNum: d.getDate(),
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
      });
    }
    return out;
  }, [anchorIso]);
  const weekCount = useMemo(() => {
    let count = 0;
    for (const d of days) count += leadsByDay.get(d.iso)?.length ?? 0;
    return count;
  }, [days, leadsByDay]);
  const rangeLabel = useMemo(() => {
    const start = parseIsoLocal(days[0].iso);
    const end = parseIsoLocal(days[6].iso);
    const sameMonth = start.getMonth() === end.getMonth();
    const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
      d.toLocaleDateString(undefined, opts);
    return sameMonth
      ? `${fmt(start, { month: "long", day: "numeric" })} – ${fmt(end, {
          day: "numeric",
          year: "numeric",
        })}`
      : `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`;
  }, [days]);

  // Hours displayed on the left rail. 7am–7pm covers a typical field-
  // service work window; blocks outside this range still render but get
  // clamped by the container so they peek in rather than overflow.
  const START_HOUR = 7;
  const END_HOUR = 19;
  const HOUR_PX = 44;
  const totalPx = (END_HOUR - START_HOUR) * HOUR_PX;
  const hours = Array.from(
    { length: END_HOUR - START_HOUR + 1 },
    (_, i) => START_HOUR + i
  );

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onShift(-1)}
          aria-label="Previous week"
          className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center flex-1">
          <div className="font-semibold">{rangeLabel}</div>
          <div className="text-[11px] text-[var(--muted)]">
            {loading
              ? "Loading…"
              : weekCount === 0
                ? "No booked estimates this week"
                : `${weekCount} booked estimate${weekCount === 1 ? "" : "s"}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onToday}
          className="inline-flex items-center justify-center h-9 px-3 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)] text-xs font-medium"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onShift(1)}
          aria-label="Next week"
          className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day header row. Each day is a Link so tapping the column header
         jumps to /route for that day. */}
      <div
        className="grid gap-px border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--border)]"
        style={{ gridTemplateColumns: "3.5rem repeat(7, minmax(0, 1fr))" }}
      >
        <div className="bg-white" />
        {days.map((d) => {
          const isToday = d.iso === todayIso;
          const count = leadsByDay.get(d.iso)?.length ?? 0;
          return (
            <Link
              key={d.iso}
              href={`/route?day=${d.iso}`}
              className={cn(
                "bg-white text-center py-2 hover:bg-[var(--surface-2)] transition-colors",
                isToday && "bg-[var(--accent-soft)]"
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">
                {d.label}
              </div>
              <div
                className={cn(
                  "inline-flex items-center justify-center h-6 w-6 mt-0.5 rounded-full text-xs tabular-nums",
                  isToday
                    ? "bg-[var(--accent)] text-white font-semibold"
                    : "text-[var(--fg)]"
                )}
              >
                {d.dayNum}
              </div>
              {count > 0 && (
                <div className="text-[10px] text-[var(--muted)] mt-0.5">
                  {count} booked
                </div>
              )}
            </Link>
          );
        })}

        {/* Hour rail + day columns. Using a single relative container per
           column keeps absolute-positioned event blocks independent of
           one another vertically. */}
        <div className="bg-white relative" style={{ height: totalPx }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 text-[10px] text-[var(--muted)] pr-1 text-right -translate-y-1/2"
              style={{ top: (h - START_HOUR) * HOUR_PX }}
            >
              {formatHour(h)}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const dayLeads = leadsByDay.get(d.iso) ?? [];
          return (
            <div
              key={d.iso}
              className="bg-white relative"
              style={{ height: totalPx }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-dashed border-[var(--border)]/60"
                  style={{ top: (h - START_HOUR) * HOUR_PX }}
                />
              ))}
              {(() => {
                // Separate flex-window leads so they stack vertically at the
                // top of the column. Without an index, multiple flex chips
                // pile onto the same coordinates and only the last one is
                // visible / clickable.
                const flexLeads = dayLeads.filter((l) => !l.scheduled_time);
                const timedLeads = dayLeads.filter((l) => l.scheduled_time);
                return (
                  <>
                    {flexLeads.map((l, idx) => (
                      <WeekEventBlock
                        key={l.id}
                        lead={l}
                        startHour={START_HOUR}
                        endHour={END_HOUR}
                        hourPx={HOUR_PX}
                        flexIndex={idx}
                      />
                    ))}
                    {timedLeads.map((l) => (
                      <WeekEventBlock
                        key={l.id}
                        lead={l}
                        startHour={START_HOUR}
                        endHour={END_HOUR}
                        hourPx={HOUR_PX}
                      />
                    ))}
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeekEventBlock({
  lead,
  startHour,
  endHour,
  hourPx,
  flexIndex,
}: {
  lead: Lead;
  startHour: number;
  endHour: number;
  hourPx: number;
  /** Index within this day's flex-window leads. Used to stack chips
   *  vertically so multiple flex leads on the same day don't render on
   *  top of each other. Undefined for timed leads. */
  flexIndex?: number;
}) {
  // Default job length when scheduled_time is set but there's no explicit
  // duration column on the lead. 60 min is a safe guess for estimates.
  const DEFAULT_MIN = 60;
  const time = lead.scheduled_time;
  const href = lead.scheduled_day
    ? `/route?day=${lead.scheduled_day}`
    : "/route";
  // Leads with only a flex window render as a chip at the top of the
  // day column rather than a positioned block, since we don't know when
  // during the window they'll land.
  if (!time) {
    const CHIP_H = 20;
    const CHIP_GAP = 2;
    const top = 4 + (flexIndex ?? 0) * (CHIP_H + CHIP_GAP);
    return (
      <Link
        href={href}
        className="absolute left-1 right-1 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] text-[10px] font-semibold px-1.5 py-0.5 truncate hover:ring-1 hover:ring-[var(--accent)]"
        style={{ top, height: CHIP_H }}
        title={`${lead.client ?? "Untitled"} — flex`}
      >
        {lead.client ?? "Untitled"}
      </Link>
    );
  }
  const [hh, mm] = time.split(":").map(Number);
  const minutesFromStart = (hh - startHour) * 60 + (mm || 0);
  const totalMinutes = (endHour - startHour) * 60;
  const clampedStart = Math.max(0, Math.min(minutesFromStart, totalMinutes));
  const top = (clampedStart / 60) * hourPx;
  const height = Math.max(22, (DEFAULT_MIN / 60) * hourPx);
  return (
    <Link
      href={href}
      className="absolute left-1 right-1 rounded-md bg-[var(--accent)]/90 text-white px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden hover:bg-[var(--accent)]"
      style={{ top, height }}
      title={`${lead.client ?? "Untitled"} at ${formatHMM(time)}`}
    >
      <div className="font-semibold truncate">{lead.client ?? "Untitled"}</div>
      <div className="opacity-90 truncate">{formatHMM(time)}</div>
    </Link>
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

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftIsoByDays(iso: string, days: number): string {
  const d = parseIsoLocal(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

function startOfWeekLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay()); // Sunday anchor
  return out;
}

function formatHour(h: number): string {
  const hh = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "a" : "p";
  return `${hh}${suffix}`;
}

function formatHMM(time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const suffix = hh < 12 ? "AM" : "PM";
  return `${h12}:${String(mm ?? 0).padStart(2, "0")} ${suffix}`;
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
