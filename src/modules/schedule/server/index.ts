// Server-only surface of the schedule module.
//
// Split out from @/modules/schedule so the main barrel can stay
// client-safe. schedule.ts has `import "server-only"` at the top, so
// re-exporting its helpers (even the pure ones like parseHHMM) from
// the main barrel drags the side effect into client bundles.

import "server-only";

export {
  suggestSlots,
  parseHHMM,
  formatHHMM,
  formatClock,
  leadAddressString,
  stopLabel,
  type SuggestHalf,
  type SlotReasoning,
  type SlotSuggestion,
  type ExistingStop,
  type SuggestInputs,
  type SuggestResult,
  type DriveFn,
} from "./schedule";

export {
  smartBookSlots,
  generateAppointmentBlocks,
  calculateDriveTime,
  calculateRouteDriveTime,
  calculateExtraDriveTime,
  calculateRouteRelationshipScore,
  applyDeadheadPenalty,
  calculateDriveTimeImpactScore,
  calculateSoonestAvailableScore,
  calculateScheduleFitScore,
  calculateRouteScore,
  calculateFinalRecommendationScore,
  getMorningRecommendations,
  getAfternoonRecommendations,
  MODE_WEIGHTS,
  type SmartBookingMode,
  type ModeWeights,
  type ScoreBreakdown,
  type ScoredSlot,
  type SmartBookingResult,
  type SmartBookingInputs,
  type RecommendationLabel,
} from "./scoring";
