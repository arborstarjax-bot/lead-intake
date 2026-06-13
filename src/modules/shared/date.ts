/**
 * Shared date helpers for the scheduler.
 *
 * Vercel runs in UTC. If we ask JavaScript for `new Date().getDate()` at
 * 9 PM Eastern it will happily say "tomorrow", because the server clock is
 * already on the next calendar day. Every calendar/schedule query must be
 * pinned to the workspace's timezone so work-day math, "scheduled_day"
 * comparisons, and "today's route" all line up with the user's wall clock.
 *
 * All helpers accept an optional `tz` (IANA timezone id). When omitted they
 * fall back to BUSINESS_TIMEZONE which defaults to America/New_York. Callers
 * with access to the workspace settings should always pass `settings.timezone`.
 */

/** Fallback when no workspace timezone is available. */
export const BUSINESS_TIMEZONE = "America/New_York";

/** YYYY-MM-DD for "today" in the given timezone. */
export function todayIsoInBusinessTz(tz: string = BUSINESS_TIMEZONE): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

/** YYYY-MM-DD for the given Date, interpreted in the given timezone. */
export function isoInBusinessTz(d: Date, tz: string = BUSINESS_TIMEZONE): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

/** Day-of-week (0=Sunday..6=Saturday) for the given Date in the given tz. */
export function dayOfWeekInBusinessTz(d: Date, tz: string = BUSINESS_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
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

/**
 * Build a Date anchored at noon UTC for a given YYYY-MM-DD business-tz day.
 *
 * Noon UTC is 7–8 AM ET regardless of DST, so converting the Date back to
 * the business tz always produces the intended calendar day — never slips
 * to the day before (which midnight-UTC would) and never slips forward.
 * This is the only safe way to iterate whole calendar days.
 */
export function dateAtBusinessTzDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Returns YYYY-MM-DD in business tz for (iso + n days). DST-safe. */
export function addDaysToBusinessTzIso(iso: string, n: number, tz: string = BUSINESS_TIMEZONE): string {
  const base = dateAtBusinessTzDay(iso);
  base.setUTCDate(base.getUTCDate() + n);
  return isoInBusinessTz(base, tz);
}

/**
 * Returns [today, today+1, ..., today+(count-1)] as Date objects anchored at
 * noon UTC for each calendar day in the given tz. Safe to pass to
 * isoInBusinessTz() and dayOfWeekInBusinessTz().
 */
export function upcomingBusinessTzDays(count: number, tz: string = BUSINESS_TIMEZONE): Date[] {
  const today = todayIsoInBusinessTz(tz);
  return Array.from({ length: count }, (_, i) =>
    dateAtBusinessTzDay(addDaysToBusinessTzIso(today, i, tz))
  );
}
