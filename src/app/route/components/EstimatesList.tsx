"use client";

import { MapPin } from "lucide-react";
import { formatDateLong, type Stop } from "../route-helpers";
import { EstimateRow } from "./EstimateRow";

/**
 * List view of every estimate on the day. Renders below the map as a
 * quick-reference card — each row is tap-through to the lead and
 * surfaces tel:, sms:, and maps: shortcuts so the installer can text or
 * call on their way to the next stop without drilling into the lead.
 *
 * This complements the existing Timeline/StopList (which emphasizes
 * drive legs + reorder affordances). The list is intentionally
 * denser: time, name, address, phone, assigned salesperson, plus one
 * row of action icons.
 */
export function EstimatesList({ stops, date }: { stops: Stop[]; date: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Estimates ({stops.length})
        </div>
        <div className="text-[11px] text-[var(--muted)]">{formatDateLong(date)}</div>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {stops.map((s, i) => (
          <EstimateRow key={s.id} stop={s} index={i + 1} />
        ))}
      </ul>
    </div>
  );
}
