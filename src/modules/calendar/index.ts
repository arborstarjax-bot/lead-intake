// Barrel for the calendar module.
//
// Surface area is split across two server files: ./server/google
// (event CRUD + the pending-claim sentinel helpers) and ./server/oauth
// (token exchange / refresh / storage). Both are server-only — the
// eslint boundary rule keeps callers from reaching past this barrel.
//
// The pending-claim sentinel (CALENDAR_PENDING_PREFIX / isPendingCalendar
// Claim / realCalendarEventId) gates concurrent POST + PATCH + DELETE on
// /api/leads/[id]/calendar and downstream batch endpoints (optimize-day,
// reorder, sync-day). Keep all three symbols co-located.

export {
  canSchedule,
  CALENDAR_PENDING_PREFIX,
  isPendingCalendarClaim,
  realCalendarEventId,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "./server/google";

export {
  googleAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  saveTokens,
  isGoogleConnected,
} from "./server/oauth";
