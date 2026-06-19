"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function MiniCalendar({
  selected,
  onSelect,
  todayIso,
}: {
  selected: string;
  onSelect: (iso: string) => void;
  todayIso: string;
}) {
  const [anchor, setAnchor] = useState(() => {
    const [y, m] = selected.split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/leads?view=all");
      const json = await res.json();
      if (!res.ok) return;
      const map = new Map<string, number>();
      for (const l of json.leads ?? []) {
        if (!l.scheduled_day) continue;
        if (l.status === "Completed" || l.status === "Lost" || l.status === "Pending") continue;
        map.set(l.scheduled_day, (map.get(l.scheduled_day) ?? 0) + 1);
      }
      setCounts(map);
    } catch {
      // Silent
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const weeks = useMemo(() => {
    const first = new Date(anchor.year, anchor.month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(anchor.year, anchor.month + 1, 0).getDate();

    const cells: (string | null)[] = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${anchor.year}-${String(anchor.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push(iso);
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [anchor]);

  const monthLabel = new Date(anchor.year, anchor.month, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" }
  );

  function prevMonth() {
    setAnchor((a) => {
      const m = a.month - 1;
      return m < 0 ? { year: a.year - 1, month: 11 } : { year: a.year, month: m };
    });
  }

  function nextMonth() {
    setAnchor((a) => {
      const m = a.month + 1;
      return m > 11 ? { year: a.year + 1, month: 0 } : { year: a.year, month: m };
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      {/* Month header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">{monthLabel}</span>
        <button
          type="button"
          onClick={nextMonth}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-semibold text-[var(--muted)] uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px">
        {weeks.flat().map((iso, i) => {
          if (!iso) {
            return <div key={`empty-${i}`} className="h-9" />;
          }
          const dayNum = parseInt(iso.split("-")[2], 10);
          const isToday = iso === todayIso;
          const isSelected = iso === selected;
          const count = counts.get(iso) ?? 0;
          const isPast = iso < todayIso;

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={cn(
                "relative flex flex-col items-center justify-center h-9 rounded-lg text-xs transition",
                isSelected
                  ? "bg-[var(--accent)] text-white font-bold"
                  : isToday
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                    : isPast
                      ? "text-[var(--subtle)] hover:bg-[var(--surface-2)]"
                      : "text-[var(--fg)] hover:bg-[var(--surface-2)]"
              )}
            >
              {dayNum}
              {count > 0 && (
                <span
                  className={cn(
                    "absolute -bottom-0.5 text-[8px] font-bold leading-none",
                    isSelected
                      ? "text-white/80"
                      : count >= 3
                        ? "text-emerald-600"
                        : "text-[var(--muted)]"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
