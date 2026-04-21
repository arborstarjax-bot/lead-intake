import "server-only";
import type { AppSettings } from "@/lib/settings";
import { homeAddressString } from "@/lib/settings";
import { getDriveMatrix } from "@/lib/maps";
import type { Lead } from "@/lib/types";

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
};

export type SuggestResult = {
  slots: SlotSuggestion[];
  /** If we had to short-circuit (no feasible slots, etc.), non-empty. */
  warnings: string[];
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
  const warnings: string[] = [];

  const home = homeAddressString(settings);
  const destAddr = leadAddressString(lead);
  if (!home) {
    return {
      slots: [],
      warnings: ["Set your starting address in Settings before using the AI scheduler."],
    };
  }
  if (!destAddr) {
    return {
      slots: [],
      warnings: ["This lead has no address yet — add one to rank by drive time."],
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

  // Batch one matrix call: origins = [home, ex_1..ex_K], destinations = [new lead].
  const originsToNew = [home, ...existing.map((e) => e.address)];
  const toNewMatrix = await getDriveMatrix(originsToNew, [destAddr]);
  const driveToNewSec = {
    fromHome: toNewMatrix[0].drive_seconds,
    fromExisting: existing.map((_, i) => toNewMatrix[i + 1].drive_seconds),
  };

  // Batch second call only if there are any existing stops.
  let driveFromNewSec: number[] = [];
  if (existing.length > 0) {
    const fromNewMatrix = await getDriveMatrix(
      [destAddr],
      existing.map((e) => e.address)
    );
    driveFromNewSec = fromNewMatrix.map((r) => r.drive_seconds);
  }

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

  // Spread picks so we don't surface three adjacent times.
  const picked: SlotSuggestion[] = [];
  const minGap = 45;
  for (const c of candidates) {
    const cMin = parseHHMM(c.startTime);
    if (picked.some((p) => Math.abs(parseHHMM(p.startTime) - cMin) < minGap)) continue;
    picked.push(c);
    if (picked.length === 3) break;
  }

  if (picked.length === 0) {
    warnings.push(
      candidates.length
        ? "All slots were too close together to show three distinct options."
        : "No feasible slots on this day inside working hours — try a different day."
    );
  }

  // Display in chronological order, not ranked order, so morning options feel
  // like morning options — but preserve rank for optional highlighting.
  picked.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));

  return { slots: picked, warnings };
}
