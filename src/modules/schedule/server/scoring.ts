import "server-only";
import type { AppSettings } from "@/lib/settings";
import { homeAddressString } from "@/lib/settings";
import { createDriveMemo } from "@/modules/routing/server";
import type { Lead } from "@/modules/leads/model";
import {
  parseHHMM,
  formatHHMM,
  formatClock,
  leadAddressString,
  type DriveFn,
  type ExistingStop,
} from "./schedule";

// ── Types ──────────────────────────────────────────────────────────

export type SmartBookingMode = "balanced" | "best_route" | "soonest";

export type ModeWeights = {
  routeRelationship: number;
  driveTimeImpact: number;
  soonestAvailable: number;
  scheduleFit: number;
};

export const MODE_WEIGHTS: Record<SmartBookingMode, ModeWeights> = {
  balanced: {
    routeRelationship: 0.4,
    driveTimeImpact: 0.35,
    soonestAvailable: 0.15,
    scheduleFit: 0.1,
  },
  best_route: {
    routeRelationship: 0.45,
    driveTimeImpact: 0.4,
    soonestAvailable: 0.05,
    scheduleFit: 0.1,
  },
  soonest: {
    routeRelationship: 0.2,
    driveTimeImpact: 0.2,
    soonestAvailable: 0.5,
    scheduleFit: 0.1,
  },
};

export type ScoreBreakdown = {
  routeRelationshipScore: number;
  driveTimeImpactScore: number;
  soonestAvailableScore: number;
  scheduleFitScore: number;
  finalScore: number;
};

export type RecommendationLabel =
  | "Best Route"
  | "Strong Route Fit"
  | "Low Drive Time"
  | "Close to Existing Estimates"
  | "Avoids Extra Driving"
  | "Soonest Available"
  | "Clean Block Fit"
  | "Good Option";

export type ScoredSlot = {
  date: string;
  startTime: string;
  endTime: string;
  driveMinutesBefore: number;
  driveMinutesAfter: number;
  extraDriveMinutes: number;
  scores: ScoreBreakdown;
  label: RecommendationLabel;
  explanation: string;
  reasoning: {
    priorLabel: string | null;
    nextLabel: string | null;
  };
  /** Number of nearby existing estimates (within ~15 min drive). */
  nearbyCount: number;
  /** Whether this slot requires skipping a block due to travel time. */
  skippedBlocks: number;
};

export type SmartBookingResult = {
  bestOverall: ScoredSlot | null;
  morningTop3: ScoredSlot[];
  afternoonTop3: ScoredSlot[];
  allSlots: ScoredSlot[];
  routeScore: number;
  warnings: string[];
};

export type SmartBookingInputs = {
  lead: Lead;
  settings: AppSettings;
  others: Lead[];
  mode: SmartBookingMode;
  /** 0 = today, 1 = tomorrow, etc. Used for soonest scoring. */
  workingDaysOut: number;
  /** Target day ISO string. */
  day: string;
  drive?: DriveFn;
};

// ── Appointment Block Generation ───────────────────────────────────

export function generateAppointmentBlocks(
  settings: AppSettings
): number[] {
  const workStart = parseHHMM(settings.work_start_time);
  const workEnd = parseHHMM(settings.work_end_time);
  const blockSize = settings.min_time_between_appointments || 60;
  const blocks: number[] = [];
  for (let t = workStart; t + blockSize <= workEnd; t += blockSize) {
    blocks.push(t);
  }
  return blocks;
}

// ── Drive Time Helpers ─────────────────────────────────────────────

export async function calculateDriveTime(
  drive: DriveFn,
  from: string,
  to: string
): Promise<number> {
  const result = await drive(from, to);
  return Math.round(result.drive_seconds / 60);
}

/**
 * Calculate total route drive time: Home → stops in order → Home.
 */
export async function calculateRouteDriveTime(
  drive: DriveFn,
  home: string,
  stops: ExistingStop[]
): Promise<number> {
  if (stops.length === 0) return 0;
  const sorted = [...stops].sort((a, b) => a.startMin - b.startMin);
  let total = 0;

  // Home → first stop
  total += await calculateDriveTime(drive, home, sorted[0].address);
  // Between stops
  for (let i = 0; i < sorted.length - 1; i++) {
    total += await calculateDriveTime(drive, sorted[i].address, sorted[i + 1].address);
  }
  // Last stop → home
  total += await calculateDriveTime(drive, sorted[sorted.length - 1].address, home);

  return total;
}

/**
 * Calculate extra drive time created by inserting new lead into the route.
 * newRoute - existingRoute.
 */
export async function calculateExtraDriveTime(
  drive: DriveFn,
  home: string,
  existing: ExistingStop[],
  newStop: { address: string; startMin: number }
): Promise<number> {
  const existingTime = await calculateRouteDriveTime(drive, home, existing);

  // Insert the new stop into the sorted list
  const allStops: ExistingStop[] = [
    ...existing,
    {
      id: "__new__",
      label: "New Lead",
      address: newStop.address,
      startMin: newStop.startMin,
      endMin: newStop.startMin + 60,
    },
  ];
  const newRouteTime = await calculateRouteDriveTime(drive, home, allStops);

  return Math.max(0, newRouteTime - existingTime);
}

// ── Score Components ───────────────────────────────────────────────

/**
 * Route Relationship Score (0–100).
 * How connected is this lead to the rest of the day?
 */
export function calculateRouteRelationshipScore(
  nearbyCount: number,
  nearestDriveMin: number
): number {
  // Base score from nearby count
  let base: number;
  if (nearbyCount >= 4) base = 100;
  else if (nearbyCount === 3) base = 85;
  else if (nearbyCount === 2) base = 70;
  else if (nearbyCount === 1) base = 40;
  else base = 10;

  // Deadhead penalties
  let penalty = 0;
  if (nearestDriveMin > 45) penalty = 60;
  else if (nearestDriveMin > 30) penalty = 40;
  else if (nearestDriveMin > 20) penalty = 20;

  return Math.max(0, base - penalty);
}

/**
 * Apply deadhead penalty to an existing score.
 */
export function applyDeadheadPenalty(
  score: number,
  nearestDriveMin: number
): number {
  let penalty = 0;
  if (nearestDriveMin > 45) penalty = 60;
  else if (nearestDriveMin > 30) penalty = 40;
  else if (nearestDriveMin > 20) penalty = 20;
  return Math.max(0, score - penalty);
}

/**
 * Drive Time Impact Score (0–100).
 * How much additional driving does this appointment create?
 */
export function calculateDriveTimeImpactScore(
  extraDriveMinutes: number
): number {
  if (extraDriveMinutes <= 5) return 100;
  if (extraDriveMinutes <= 10) return 85;
  if (extraDriveMinutes <= 15) return 70;
  if (extraDriveMinutes <= 25) return 50;
  if (extraDriveMinutes <= 40) return 25;
  return 5;
}

/**
 * Soonest Available Score (0–100).
 * How soon can this appointment happen?
 */
export function calculateSoonestAvailableScore(
  workingDaysOut: number
): number {
  if (workingDaysOut <= 0) return 100; // today
  if (workingDaysOut === 1) return 100; // tomorrow
  if (workingDaysOut === 2) return 90;
  if (workingDaysOut === 3) return 80;
  if (workingDaysOut === 4) return 70;
  // Gradual decrease: 60, 50, 40, 30, 20, 10
  return Math.max(10, 100 - workingDaysOut * 10);
}

/**
 * Schedule Fit Score (0–100).
 * How well does the new lead fit between existing stops?
 */
export function calculateScheduleFitScore(
  driveBeforeMin: number,
  driveAfterMin: number,
  blockSize: number
): number {
  const easyThreshold = blockSize / 2;

  const beforeFit = driveBeforeMin <= easyThreshold ? "easy" :
    driveBeforeMin <= blockSize ? "skip" : "heavy";
  const afterFit = driveAfterMin <= easyThreshold ? "easy" :
    driveAfterMin <= blockSize ? "skip" : "heavy";

  // Count skipped blocks
  const beforeSkips = driveBeforeMin <= easyThreshold ? 0 :
    Math.ceil(driveBeforeMin / blockSize);
  const afterSkips = driveAfterMin <= easyThreshold ? 0 :
    Math.ceil(driveAfterMin / blockSize);

  if (beforeFit === "easy" && afterFit === "easy") return 100;
  if (beforeSkips + afterSkips === 1) return 65;
  if (beforeFit === "heavy" || afterFit === "heavy") return 10;
  return 35;
}

/**
 * Calculate Route Score for a day (0–100).
 * Higher = less driving, better clustering, fewer deadhead trips.
 */
export async function calculateRouteScore(
  drive: DriveFn,
  home: string,
  stops: ExistingStop[]
): Promise<number> {
  if (stops.length === 0) return 50; // Neutral for empty day
  if (stops.length === 1) {
    const driveMin = await calculateDriveTime(drive, home, stops[0].address);
    // Simple scoring: close to home = high score
    if (driveMin <= 10) return 90;
    if (driveMin <= 20) return 75;
    if (driveMin <= 30) return 60;
    return 40;
  }

  const totalDrive = await calculateRouteDriveTime(drive, home, stops);
  const avgPerStop = totalDrive / stops.length;

  // Score based on average drive per stop
  if (avgPerStop <= 10) return 95;
  if (avgPerStop <= 15) return 85;
  if (avgPerStop <= 20) return 75;
  if (avgPerStop <= 25) return 65;
  if (avgPerStop <= 30) return 55;
  if (avgPerStop <= 40) return 40;
  return 25;
}

/**
 * Calculate the combined final recommendation score.
 */
export function calculateFinalRecommendationScore(
  scores: Omit<ScoreBreakdown, "finalScore">,
  weights: ModeWeights
): number {
  return Math.round(
    scores.routeRelationshipScore * weights.routeRelationship +
    scores.driveTimeImpactScore * weights.driveTimeImpact +
    scores.soonestAvailableScore * weights.soonestAvailable +
    scores.scheduleFitScore * weights.scheduleFit
  );
}

// ── Recommendation Label ───────────────────────────────────────────

function pickLabel(scores: ScoreBreakdown, _mode: SmartBookingMode): RecommendationLabel {
  if (scores.routeRelationshipScore >= 85 && scores.driveTimeImpactScore >= 85) {
    return "Best Route";
  }
  if (scores.routeRelationshipScore >= 70) return "Strong Route Fit";
  if (scores.driveTimeImpactScore >= 85) return "Low Drive Time";
  if (scores.routeRelationshipScore >= 40) return "Close to Existing Estimates";
  if (scores.driveTimeImpactScore >= 70) return "Avoids Extra Driving";
  if (scores.soonestAvailableScore >= 90) return "Soonest Available";
  if (scores.scheduleFitScore >= 85) return "Clean Block Fit";
  return "Good Option";
}

// ── Explanation Generator ──────────────────────────────────────────

function buildExplanation(
  slot: {
    extraDriveMinutes: number;
    nearbyCount: number;
    skippedBlocks: number;
    driveMinutesBefore: number;
  },
  scores: ScoreBreakdown,
  existingCount: number
): string {
  const parts: string[] = [];

  if (slot.nearbyCount > 0) {
    parts.push(
      `close to ${slot.nearbyCount} existing estimate${slot.nearbyCount > 1 ? "s" : ""}`
    );
  }

  if (slot.extraDriveMinutes <= 10) {
    parts.push(`adds only ${slot.extraDriveMinutes} min of drive time`);
  } else {
    parts.push(`adds ${slot.extraDriveMinutes} min of drive time`);
  }

  if (scores.scheduleFitScore >= 85) {
    parts.push("fits cleanly into the appointment block system");
  } else if (slot.skippedBlocks > 0) {
    parts.push(
      `requires ${slot.skippedBlocks} skipped block${slot.skippedBlocks > 1 ? "s" : ""}`
    );
  }

  if (scores.routeRelationshipScore >= 70 && existingCount > 0) {
    parts.push("improves the daily route score");
  }

  if (slot.nearbyCount === 0 && existingCount > 0) {
    parts.push("isolated from other estimates");
  }

  if (parts.length === 0) return "Available slot.";

  // Capitalize first word and join
  const sentence = parts.join(", ");
  return "Recommended because this lead is " + sentence + ".";
}

// ── Main Smart Booking Engine ──────────────────────────────────────

export async function smartBookSlots(
  inp: SmartBookingInputs
): Promise<SmartBookingResult> {
  const { lead, settings, others, mode, workingDaysOut, day } = inp;
  const drive = inp.drive ?? createDriveMemo();
  const warnings: string[] = [];
  const weights = MODE_WEIGHTS[mode];

  const home = homeAddressString(settings);
  const destAddr = leadAddressString(lead);
  if (!home) {
    return {
      bestOverall: null,
      morningTop3: [],
      afternoonTop3: [],
      allSlots: [],
      routeScore: 0,
      warnings: ["Set your starting address in Settings before using Smart Booking."],
    };
  }
  if (!destAddr) {
    return {
      bestOverall: null,
      morningTop3: [],
      afternoonTop3: [],
      allSlots: [],
      routeScore: 0,
      warnings: ["This lead has no address yet — add one to use Smart Booking."],
    };
  }

  const blockSize = settings.min_time_between_appointments || 60;
  const easyThreshold = blockSize / 2;

  // Build existing stops
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
      endMin: startMin + blockSize,
    });
  }
  existing.sort((a, b) => a.startMin - b.startMin);

  // Calculate route score for current day
  const routeScore = await calculateRouteScore(drive, home, existing);

  // Pre-compute drive times
  const [fromHomeSec, toHomeSec] = await Promise.all([
    drive(home, destAddr).then((r) => r.drive_seconds),
    drive(destAddr, home).then((r) => r.drive_seconds),
  ]);
  const fromHomeMin = Math.round(fromHomeSec / 60);
  const _toHomeMin = Math.round(toHomeSec / 60);

  // Drive times between existing stops and new lead
  const toExistingMin = await Promise.all(
    existing.map((e) => calculateDriveTime(drive, e.address, destAddr))
  );
  const fromExistingMin = await Promise.all(
    existing.map((e) => calculateDriveTime(drive, destAddr, e.address))
  );

  // Count nearby estimates (within ~15 min)
  const nearbyThreshold = 15;
  const nearbyCount = toExistingMin.filter((d) => d <= nearbyThreshold).length;
  const nearestDriveMin = existing.length > 0
    ? Math.min(...toExistingMin)
    : fromHomeMin;

  // Soonest available score for this day
  const soonestScore = calculateSoonestAvailableScore(workingDaysOut);

  // Generate appointment blocks
  const blocks = generateAppointmentBlocks(settings);

  // Score each block
  const scored: ScoredSlot[] = [];
  for (const blockStart of blocks) {
    // Check if occupied
    const overlaps = existing.some(
      (e) => blockStart < e.endMin && e.startMin < blockStart + blockSize
    );
    if (overlaps) continue;

    // Find prior and next stops
    let priorIdx = -1;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].endMin <= blockStart) priorIdx = i;
      else break;
    }
    let nextIdx = -1;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].startMin >= blockStart + blockSize) {
        nextIdx = i;
        break;
      }
    }

    const driveBeforeMin = priorIdx === -1
      ? fromHomeMin
      : toExistingMin[priorIdx];
    const driveAfterMin = nextIdx === -1
      ? 0  // Will go home eventually, but scored separately
      : fromExistingMin[nextIdx];

    // Travel Overflow: check if we need to skip blocks
    const blocksSkippedBefore = driveBeforeMin <= easyThreshold ? 0 :
      Math.ceil(driveBeforeMin / blockSize);
    const blocksSkippedAfter = driveAfterMin <= easyThreshold ? 0 :
      (nextIdx === -1 ? 0 : Math.ceil(driveAfterMin / blockSize));
    const totalSkipped = blocksSkippedBefore + blocksSkippedAfter;

    // Check travel overflow rule: if drive > blockSize, heavy penalty
    // but don't skip the slot entirely — just penalize
    const overBlockDrive = driveBeforeMin > blockSize || driveAfterMin > blockSize;

    // Calculate extra drive time
    const extraDrive = await calculateExtraDriveTime(
      drive, home, existing,
      { address: destAddr, startMin: blockStart }
    );

    // Component scores
    const routeRelScore = calculateRouteRelationshipScore(
      nearbyCount, nearestDriveMin
    );
    const driveImpactScore = calculateDriveTimeImpactScore(extraDrive);
    const fitScore = calculateScheduleFitScore(
      driveBeforeMin, driveAfterMin, blockSize
    );

    const componentScores = {
      routeRelationshipScore: routeRelScore,
      driveTimeImpactScore: driveImpactScore,
      soonestAvailableScore: soonestScore,
      scheduleFitScore: fitScore,
    };

    let finalScore = calculateFinalRecommendationScore(
      componentScores, weights
    );

    // Extra penalty for over-block drives
    if (overBlockDrive) {
      finalScore = Math.max(0, finalScore - 15);
    }

    const fullScores: ScoreBreakdown = {
      ...componentScores,
      finalScore,
    };

    const label = pickLabel(fullScores, mode);

    const priorLabel = priorIdx === -1
      ? "first job of day"
      : `from ${existing[priorIdx].label} · ${formatClock(existing[priorIdx].startMin)}`;
    const nextLabel = nextIdx === -1
      ? null
      : `to ${existing[nextIdx].label} · ${formatClock(existing[nextIdx].startMin)}`;

    scored.push({
      date: day,
      startTime: formatHHMM(blockStart),
      endTime: formatHHMM(blockStart + blockSize),
      driveMinutesBefore: driveBeforeMin,
      driveMinutesAfter: driveAfterMin,
      extraDriveMinutes: extraDrive,
      scores: fullScores,
      label,
      explanation: buildExplanation(
        {
          extraDriveMinutes: extraDrive,
          nearbyCount,
          skippedBlocks: totalSkipped,
          driveMinutesBefore: driveBeforeMin,
        },
        fullScores,
        existing.length
      ),
      reasoning: { priorLabel, nextLabel },
      nearbyCount,
      skippedBlocks: totalSkipped,
    });
  }

  // Sort by finalScore descending
  scored.sort((a, b) => b.scores.finalScore - a.scores.finalScore);

  // Split AM/PM
  const morning = scored.filter((s) => parseHHMM(s.startTime) < 720);
  const afternoon = scored.filter((s) => parseHHMM(s.startTime) >= 720);

  const bestOverall = scored[0] ?? null;
  const morningTop3 = morning.slice(0, 3);
  const afternoonTop3 = afternoon.slice(0, 3);

  if (scored.length === 0) {
    warnings.push("No feasible slots on this day inside working hours — try a different day.");
  }

  return {
    bestOverall,
    morningTop3,
    afternoonTop3,
    allSlots: scored,
    routeScore,
    warnings,
  };
}

// ── Morning/Afternoon Recommendation Getters ───────────────────────

export function getMorningRecommendations(result: SmartBookingResult): ScoredSlot[] {
  return result.morningTop3;
}

export function getAfternoonRecommendations(result: SmartBookingResult): ScoredSlot[] {
  return result.afternoonTop3;
}
