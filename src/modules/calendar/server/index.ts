// Server-only surface of the calendar module.
//
// ./oauth transitively imports @/modules/shared/supabase/server, and
// ./google holds the Google Calendar event CRUD functions + the
// pending-claim sentinel helpers (gate for concurrent POST/PATCH/
// DELETE on /api/leads/[id]/calendar). All server-side.

import "server-only";

export {
  canSchedule,
  CALENDAR_PENDING_PREFIX,
  isPendingCalendarClaim,
  realCalendarEventId,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "./google";

export {
  googleAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  saveTokens,
  isGoogleConnected,
} from "./oauth";
