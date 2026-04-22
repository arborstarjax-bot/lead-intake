"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { dayChipLabel, type DayPreview } from "../route-helpers";
import { DayChipBadge } from "./DayChipBadge";

export function DayPicker({
  days,
  todayIso,
  selected,
  onSelect,
  scheduleLeadId,
}: {
  days: string[];
  todayIso: string;
  selected: string;
  onSelect: (iso: string) => void;
  scheduleLeadId: string | null;
}) {
  // When scheduling, fetch the week preview so each day chip gets a drive-
  // cost badge (same data the old modal used).
  const [week, setWeek] = useState<Map<string, DayPreview> | null>(null);
  useEffect(() => {
    if (!scheduleLeadId) {
      setWeek(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/schedule/week", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: scheduleLeadId }),
        });
        const json = await res.json();
        if (cancelled || !res.ok) return;
        const map = new Map<string, DayPreview>();
        for (const d of (json.days ?? []) as DayPreview[]) map.set(d.date, d);
        setWeek(map);
      } catch {
        // Silent — chips just render without cost pills.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduleLeadId]);

  // Best day is ranked on effectiveBestMinutes, which factors in clustering
  // bonuses. A day with 22 min driving + a same-zip stop already booked can
  // beat a day with 20 min driving and nothing booked nearby, because
  // stacking the route in the same area saves driving across the whole week.
  const bestMinutes = useMemo(() => {
    if (!week) return null;
    const costs: number[] = [];
    for (const d of week.values()) {
      if (d.isWorkDay && d.effectiveBestMinutes != null)
        costs.push(d.effectiveBestMinutes);
    }
    return costs.length ? Math.min(...costs) : null;
  }, [week]);

  return (
    <nav
      aria-label="Pick a day"
      className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar"
    >
      <div className="inline-flex gap-2 px-4 sm:px-0">
        {days.map((iso) => {
          const { top, bottom } = dayChipLabel(iso, todayIso);
          const active = iso === selected;
          const preview = week?.get(iso);
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              className={cn(
                "relative flex flex-col items-center justify-center shrink-0 w-[64px] h-[64px] rounded-xl border transition-colors",
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-gray-50"
              )}
            >
              <span className="text-[11px] font-medium uppercase tracking-wider">
                {top}
              </span>
              <span className="text-lg font-semibold leading-none mt-0.5">
                {bottom}
              </span>
              {preview && <DayChipBadge preview={preview} best={bestMinutes} />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
