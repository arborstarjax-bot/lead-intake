import "server-only";
import type { AppSettings } from "@/lib/settings";
import { homeAddressString } from "@/lib/settings";
import { createDriveMemo } from "@/modules/routing/server";
import type { Lead } from "@/modules/leads/model";

/** Drive-time callback used internally by suggestSlots. Stable signature so
 * the week endpoint can share a single memo across many day calls and avoid
 * re-charging Google for pairs we've already priced. */
export type DriveFn = ReturnType<typeof createDriveMemo>;

export type SuggestHalf = "morning" | "afternoon" | "all";

export type SlotReasoning = {
  /** Prior stop label e.g. "from Johnson · 9:00 AM" or "from Home" or null if first of day. */
  priorLabel: string | null;
  /** Next stop label e.g. "to Patel · 2:00 PM" or null if last of day. */
  nextLabel: string | null;
};

export type SlotSuggestion = {
  /** "HH:MM" 24-hour. */
  startTime: string;
  /** "HH:MM" 24-hour. */
  endTime: string;
  /** Minutes driving *to* this slot from the prior stop (or home). */
  driveMinutesBefore: number;
  /** Minutes driving *from* this slot to the next stop (0 if last of day). */
  driveMinutesAfter: number;
  /** Sum of before+after — what we rank on. */
  totalDriveMinutes: number;
  reasoning: SlotReasoning;
};

export type ExistingStop = {
  id: string;
  label: string;
  address: string;
  /** Minutes after midnight, local. */
  startMin: number;
  endMin: number;
};

/** Parse "HH:MM" or "HH:MM:SS" → minutes after midnight. */
export function parseHHMM(t: string): number {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) throw new Error(`invalid time ${t}`);
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function formatHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function leadAddressString(lead: Lead): string | null {
  const parts = [lead.address, lead.city, lead.state, lead.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Short "ClientName · 9:00 AM" label for display in reasoning. */
export function stopLabel(
  name: string | null,
  startMin: number,
  direction: "from" | "to"
): string {
  const who = name?.trim() || "job";
  return `${direction} ${who} · ${formatClock(startMin)}`;
}

export type SuggestInputs = {
  lead: Lead;
  settings: AppSettings;
  others: Lead[];
  half: SuggestHalf;
  /** Optional override for "now" (testing only). Epoch seconds. */
  nowEpochSeconds?: number;
  /** Optional shared memo so the week endpoint can reuse prices across days. */
  drive?: DriveFn;
  /**
   * Which page of ranked slots to return. Zero-based — the UI uses this to
   * cycle through alternate sets of 3 suggestions ("Show me different times").
   * Each page returns the next 3 best-ranked slots skipping earlier pages.
   */
  offset?: number;
};

export type SuggestResult = {
  slots: SlotSuggestion[];
  /** If we had to short-circuit (no feasible slots, etc.), non-empty. */
  warnings: string[];
  /** True when more ranked slots exist beyond the current page. */
  hasMore: boolean;
  /** Total number of feasible slots on this day (all pages combined). */
  totalCount: number;
};

/**
 * Build ranked slot suggestions for a given lead on its `scheduled_day`.
 *
 * Algorithm (hour-block first, drive-aware fallback):
 * 1. Build timeline of existing same-day stops (sorted by start time).
 * 2. Enumerate candidate slots on 1-hour boundaries starting at workStart.
 * 3. Skip slots that overlap an existing stop.
 * 4. For the nearest existing neighbor, check drive time — only bump past
 *    the next hour boundary if drive > 30 min.
 * 5. Return slots in chronological order. Drive time is informational only
 *    (not used for ranking); slots are ordered earliest-first.
 */
export async function suggestSlots(inp: SuggestInputs): Promise<SuggestResult> {
  const { lead, settings, others, half } = inp;
  const offset = Math.max(0, inp.offset ?? 0);
  const drive = inp.drive ?? createDriveMemo();
  const warnings: string[] = [];

  const home = homeAddressString(settings);
  const destAddr = leadAddressString(lead);
  if (!home) {
    return {
      slots: [],
      warnings: ["Set your starting address in Settings before using the AI scheduler."],
      hasMore: false,
      totalCount: 0,
    };
  }
  if (!destAddr) {
    return {
      slots: [],
      warnings: ["This lead has no address yet — add one to rank by drive time."],
      hasMore: false,
      totalCount: 0,
    };
  }

  const workStart = parseHHMM(settings.work_start_time);
  const workEnd = parseHHMM(settings.work_end_time);
  const duration = settings.min_time_between_appointments;

  const existing: ExistingStop[] = [];
  for (const other of others) {
    const otherAddr = leadAddressString(other);
    if (!otherAddr || !other.scheduled_time) continue;
    const startMin = parseHHMM(other.scheduled_time);
    existing.push({
      id: other.id,
      label: other.client?.trim() || "job",
      address: otherAddr,
      startMin,
      endMin: startMin + duration,
    });
  }
  existing.sort((a, b) => a.startMin - b.startMin);

  // Prefetch drive times for informational display + 30-min bump check.
  const [fromHome, toExisting, fromExisting] = await Promise.all([
    drive(home, destAddr).then((r) => r.drive_seconds),
    Promise.all(existing.map((e) => drive(e.address, destAddr).then((r) => r.drive_seconds))),
    Promise.all(existing.map((e) => drive(destAddr, e.address).then((r) => r.drive_seconds))),
  ]);

  // Enumerate 1-hour boundary slots starting at workStart.
  const step = 60;
  const candidates: SlotSuggestion[] = [];
  for (let start = workStart; start + duration <= workEnd; start += step) {
    if (half === "morning" && start >= 12 * 60) continue;
    if (half === "afternoon" && start < 12 * 60) continue;

    // Skip if this slot overlaps an existing stop.
    const overlaps = existing.some((e) => start < e.endMin && e.startMin < start + duration);
    if (overlaps) continue;

    // Find nearest prior and next existing stops for context.
    let priorIdx = -1;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].endMin <= start) priorIdx = i;
      else break;
    }
    let nextIdx = -1;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].startMin >= start + duration) {
        nextIdx = i;
        break;
      }
    }

    const driveBeforeSec =
      priorIdx === -1 ? fromHome : toExisting[priorIdx];
    const driveAfterSec =
      nextIdx === -1 ? 0 : fromExisting[nextIdx];

    // If drive time from the prior stop (or home) is > 30 min, this slot
    // is too tight — skip it so the next hour boundary is suggested instead.
    const driveBeforeMin = Math.ceil(driveBeforeSec / 60);
    if (driveBeforeMin > 30) continue;

    // Similarly, if drive to the next stop is > 30 min and the gap between
    // this slot's end and the next stop isn't large enough, skip.
    if (nextIdx !== -1) {
      const driveAfterMin = Math.ceil(driveAfterSec / 60);
      const gapToNext = existing[nextIdx].startMin - (start + duration);
      if (driveAfterMin > 30 && gapToNext < driveAfterMin) continue;
    }

    const before = Math.round(driveBeforeSec / 60);
    const after = Math.round(driveAfterSec / 60);
    candidates.push({
      startTime: formatHHMM(start),
      endTime: formatHHMM(start + duration),
      driveMinutesBefore: before,
      driveMinutesAfter: after,
      totalDriveMinutes: before + after,
      reasoning: {
        priorLabel:
          priorIdx === -1
            ? "first job of day"
            : stopLabel(existing[priorIdx].label, existing[priorIdx].startMin, "from"),
        nextLabel:
          nextIdx === -1
            ? null
            : stopLabel(existing[nextIdx].label, existing[nextIdx].startMin, "to"),
      },
    });
  }

  // Slots are already in chronological order (earliest first).
  const PAGE_SIZE = 5;
  const totalPicked = candidates.length;
  const pageStart = offset * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const page = candidates.slice(pageStart, pageEnd);
  const hasMore = totalPicked > pageEnd;

  if (page.length === 0) {
    warnings.push(
      totalPicked > 0
        ? "No more distinct slots — go back to the first page."
        : "No feasible slots on this day inside working hours — try a different day."
    );
  }

  return {
    slots: page,
    warnings,
    hasMore,
    totalCount: totalPicked,
  };
}
