// Client-safe barrel for the schedule module.
//
// Only ScheduleModal is exposed here. The slot-suggestion engine and
// HH:MM helpers live under @/modules/schedule/server (server-only).

export { default as ScheduleModal } from "./ui/ScheduleModal";
