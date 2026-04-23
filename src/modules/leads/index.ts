// Barrel for the leads module.
//
// Model types (Lead, LeadStatus, EDITABLE_COLUMNS, …) live under
// ./model and are also re-exported here for convenience. Callers
// outside the module may import either path — model.ts is not under
// server/client/ui so the eslint boundary rule doesn't restrict it.
//
// Server-side helpers (findDuplicates, isSaveable) and UI components
// flow through this barrel so callers never need to reach into
// server/ or ui/ subpaths.

export * from "./model";

export {
  findDuplicates,
  isSaveable,
  type DuplicateMatch,
} from "./server/dedupe";

// LeadTable and StandaloneLeadCard are default exports on their
// source files; re-export them as default-style named re-exports so
// callers can use `import LeadTable from "@/modules/leads"` OR
// `import { LeadTable } from "@/modules/leads"` — matching the
// pattern that was already in use before the move.
export { default as LeadTable } from "./ui/LeadTable";
export { default as StandaloneLeadCard } from "./ui/StandaloneLeadCard";
export { LeadCard } from "./ui/lead-table/LeadCard";
export type { LeadFilter, LeadCounts } from "./ui/LeadTable";
