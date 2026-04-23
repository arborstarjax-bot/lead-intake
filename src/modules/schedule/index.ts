// Barrel for the schedule module.
//
// The schedule server file holds the slot-suggestion engine
// (suggestSlots) plus the shared HH:MM parse/format helpers and
// types that the api/schedule/* route handlers pass around. The
// ScheduleModal UI component is the single manual "Find best day"
// entrypoint — other schedule-picker UIs (SchedulePanel on /route,
// the inline reschedule drawer on /leads) currently live inside
// their respective app pages and fold into this module in R-9.

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
} from "./server/schedule";

export { default as ScheduleModal } from "./ui/ScheduleModal";
