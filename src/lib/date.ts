/**
 * Shared date helpers for the scheduler.
 *
 * Vercel runs in UTC. If we ask JavaScript for `new Date().getDate()` at
 * 9 PM Eastern it will happily say "tomorrow", because the server clock is
 * already on the next calendar day. Every calendar/schedule query must be
 * pinned to the business timezone (America/New_York) so work-day math,
 * "scheduled_day" comparisons, and "today's route" all line up with what the
 * user's wall clock says.
 */

export const BUSINESS_TIMEZONE = "America/New_York";

/** YYYY-MM-DD for "today" in the business timezone. */
export function todayIsoInBusinessTz(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TIMEZONE });
}

/** YYYY-MM-DD for the given Date, interpreted in the business timezone. */
export function isoInBusinessTz(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: BUSINESS_TIMEZONE });
}

/** Day-of-week (0=Sunday..6=Saturday) for the given Date in the business tz. */
export function dayOfWeekInBusinessTz(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[parts] ?? d.getDay();
}
