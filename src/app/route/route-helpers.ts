import type { useConfirm } from "@/components/ConfirmDialog";
import type { LeadFlexWindow } from "@/lib/types";

export type Stop = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  startTime: string;
  endTime: string;
  driveMinutesFromPrev: number | null;
  distanceMilesFromPrev: number | null;
  firstName: string | null;
  phoneNumber: string | null;
  salesPerson: string | null;
};

/**
 * Flex-window lead on the day. Same shape as Stop minus the time/leg
 * fields — flex stops are grouped separately and don't participate in
 * the numbered sequence or drive-leg math. The estimates UI renders a
 * "Flex — All Day / AM / PM" label in place of a start time.
 */
export type FlexStop = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  flexWindow: LeadFlexWindow;
  firstName: string | null;
  phoneNumber: string | null;
  salesPerson: string | null;
};

export type Ghost = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  desiredDay: string | null;
  currentTime: string | null;
};

export type RouteResponse = {
  date: string;
  home: { lat: number; lng: number; address: string } | null;
  stops: Stop[];
  flexStops: FlexStop[];
  unresolved: { id: string; label: string; address: string }[];
  totalDriveMinutes: number | null;
  returnDriveMinutes: number | null;
  ghost: Ghost | null;
  ghostError: string | null;
};

export type Half = "all" | "morning" | "afternoon";

export type Slot = {
  startTime: string;
  endTime: string;
  driveMinutesBefore: number;
  driveMinutesAfter: number;
  totalDriveMinutes: number;
  reasoning: { priorLabel: string | null; nextLabel: string | null };
};

export type DayPreview =
  | {
      date: string;
      isWorkDay: true;
      bestTotalDriveMinutes: number | null;
      /** Minutes of ranking discount because the day has same-area stops. */
      clusterBonusMinutes: number;
      /** What the UI actually sorts by: best - clusterBonus (min 0). */
      effectiveBestMinutes: number | null;
      slotCount: number;
    }
  | { date: string; isWorkDay: false };

/** Pure ET-safe YYYY-MM-DD math. Adds n days to the given iso date. */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + n);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

/** Today in America/New_York, YYYY-MM-DD. Matches the server-side helper. */
export function todayEtIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function formatClock(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${min} ${ampm}`;
}

export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function dayChipLabel(
  iso: string,
  todayIso: string
): { top: string; bottom: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (iso === todayIso) return { top: "Today", bottom: String(dt.getUTCDate()) };
  if (iso === addDaysIso(todayIso, 1))
    return { top: "Tmrw", bottom: String(dt.getUTCDate()) };
  const weekday = dt.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
  return { top: weekday, bottom: String(dt.getUTCDate()) };
}

/**
 * Shared handler for 428 responses from calendar-touching endpoints.
 * Pops our in-app confirm and, on yes, sends the user through the
 * Google OAuth redirect. Returns `true` if we handled a 428 (caller
 * should return early) — `false` otherwise.
 */
export async function handleCalendarDisconnected(
  res: Response,
  json: { connectUrl?: string } | null,
  confirmDialog: ReturnType<typeof useConfirm>
): Promise<boolean> {
  if (res.status !== 428) return false;
  const ok = await confirmDialog({
    title: "Connect Google Calendar?",
    message: "Your calendar isn’t linked yet. Sign in with Google to keep bookings in sync.",
    confirmLabel: "Connect",
  });
  if (ok && json?.connectUrl) window.location.href = json.connectUrl;
  return true;
}
