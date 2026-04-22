import "server-only";
import type { AppSettings } from "@/lib/settings";
import { homeAddressString } from "@/lib/settings";
import { createDriveMemo } from "@/lib/maps";
import type { Lead } from "@/lib/types";

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
 * Algorithm:
 * 1. Build timeline of other same-day stops (sorted by start time).
 * 2. Enumerate candidate 30-minute slots inside working hours, filtered by half.
 * 3. For each candidate, compute prior + next stop and the drive time cost.
 * 4. Drop infeasible ones (can't arrive on time / can't make next job on time).
 * 5. Sort by total drive minutes ascending; dedup to spread picks by ≥ 45 min.
 * 6. Return top 3 with human-readable reasoning labels.
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
  const duration = settings.default_job_minutes;
  const buffer = settings.travel_buffer_minutes;

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

  // Prefetch drive times we'll need. If a shared memo was passed in (week
  // endpoint) these calls fan into the cache instead of hitting Google again.
  const [fromHome, toExisting, fromExisting] = await Promise.all([
    drive(home, destAddr).then((r) => r.drive_seconds),
    Promise.all(existing.map((e) => drive(e.address, destAddr).then((r) => r.drive_seconds))),
    Promise.all(existing.map((e) => drive(destAddr, e.address).then((r) => r.drive_seconds))),
  ]);
  const driveToNewSec = { fromHome, fromExisting: toExisting };
  const driveFromNewSec = fromExisting;

  const step = 30;
  const candidates: SlotSuggestion[] = [];
  for (let start = workStart; start + duration <= workEnd; start += step) {
    if (half === "morning" && start >= 12 * 60) continue;
    if (half === "afternoon" && start < 12 * 60) continue;

    // Prior = last existing stop ending at-or-before start. Else home.
    let priorIdx = -1;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].endMin <= start) priorIdx = i;
      else break;
    }
    // Next = first existing stop starting at-or-after (start + duration).
    let nextIdx = -1;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].startMin >= start + duration) {
        nextIdx = i;
        break;
      }
    }

    // Enforce no overlap with an existing stop.
    const overlaps = existing.some((e) => {
      const candStart = start;
      const candEnd = start + duration;
      return candStart < e.endMin && e.startMin < candEnd;
    });
    if (overlaps) continue;

    const driveBeforeSec =
      priorIdx === -1 ? driveToNewSec.fromHome : driveToNewSec.fromExisting[priorIdx];
    const priorEnd = priorIdx === -1 ? workStart : existing[priorIdx].endMin;
    const earliestArrival = priorEnd + buffer + Math.ceil(driveBeforeSec / 60);
    if (earliestArrival > start) continue;

    let driveAfterSec = 0;
    if (nextIdx !== -1) {
      driveAfterSec = driveFromNewSec[nextIdx];
      const latestDeparture = start + duration + buffer + Math.ceil(driveAfterSec / 60);
      if (latestDeparture > existing[nextIdx].startMin) continue;
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

  candidates.sort((a, b) => a.totalDriveMinutes - b.totalDriveMinutes);

  // Build the full ordered set of spread picks across all pages. Using a
  // shrinking `minGap` when the earlier pages exhaust distinct-enough
  // candidates lets later pages still surface useful alternatives instead
  // of "no more slots" after the first 3.
  const PAGE_SIZE = 3;
  const allPicked: SlotSuggestion[] = [];
  const gapSteps = [45, 30, 15, 0];
  for (const minGap of gapSteps) {
    for (const c of candidates) {
      if (allPicked.some((p) => p.startTime === c.startTime)) continue;
      const cMin = parseHHMM(c.startTime);
      if (
        minGap > 0 &&
        allPicked.some((p) => Math.abs(parseHHMM(p.startTime) - cMin) < minGap)
      ) {
        continue;
      }
      allPicked.push(c);
    }
    if (allPicked.length >= (offset + 1) * PAGE_SIZE + PAGE_SIZE) break;
  }

  const pageStart = offset * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const page = allPicked.slice(pageStart, pageEnd);
  const hasMore = allPicked.length > pageEnd;

  if (page.length === 0) {
    warnings.push(
      allPicked.length > 0
        ? "No more distinct slots — go back to the first page."
        : candidates.length
        ? "All slots were too close together to show three distinct options."
        : "No feasible slots on this day inside working hours — try a different day."
    );
  }

  // Display in chronological order within the page, not ranked order, so
  // morning options feel like morning options — but preserve rank for
  // optional highlighting.
  page.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));

  return {
    slots: page,
    warnings,
    hasMore,
    totalCount: allPicked.length,
  };
}
