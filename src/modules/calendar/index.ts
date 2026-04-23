// The calendar module has no client-safe exports. Server callers
// (api/leads/[id]/calendar, google/callback, google/connect,
// google/status, schedule/reorder, schedule/optimize-day,
// schedule/sync-day, the leads PATCH handler) use
// @/modules/calendar/server.
//
// This file exists so the module directory has a conventional
// index.ts; it is intentionally empty.

export {};
