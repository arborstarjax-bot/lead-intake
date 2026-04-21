import type { Lead } from "@/lib/types";
import { calendarEventTitle, formatPhone } from "@/lib/format";

type GoogleEvent = {
  id: string;
  htmlLink?: string;
};

function buildDescription(lead: Lead): string {
  const lines = [
    `First Name: ${lead.first_name ?? ""}`,
    `Last Name: ${lead.last_name ?? ""}`,
    `Client: ${lead.client ?? ""}`,
    `Phone Number: ${formatPhone(lead.phone_number)}`,
    `Email: ${lead.email ?? ""}`,
    `Address: ${lead.address ?? ""}`,
    `City: ${lead.city ?? ""}`,
    `State: ${lead.state ?? ""}`,
    `Zip: ${lead.zip ?? ""}`,
    `Status: ${lead.status}`,
    `Sales Person: ${lead.sales_person ?? ""}`,
    `Scheduled Day: ${lead.scheduled_day ?? ""}`,
    `Scheduled Time: ${lead.scheduled_time ?? ""}`,
    "",
    "Notes:",
    lead.notes ?? "",
  ];
  return lines.join("\n");
}

function buildLocation(lead: Lead): string | undefined {
  const parts = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function buildStartEnd(
  day: string,
  time: string | null
): { start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } } | null {
  // `day` is ISO YYYY-MM-DD. `time` may come back from Postgres `time` column
  // as "HH:MM" or "HH:MM:SS"; accept both and fall back to 09:00 if absent.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const m = time?.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  const hh = m ? m[1] : "09";
  const mm = m ? m[2] : "00";
  const start = `${day}T${hh}:${mm}:00`;
  const endH = String((Number(hh) + 1) % 24).padStart(2, "0");
  const end = `${day}T${endH}:${mm}:00`;
  return {
    start: { dateTime: start, timeZone: "America/New_York" },
    end: { dateTime: end, timeZone: "America/New_York" },
  };
}

export function canSchedule(lead: Lead): boolean {
  return Boolean(lead.scheduled_day && /^\d{4}-\d{2}-\d{2}$/.test(lead.scheduled_day));
}

export async function createCalendarEvent(
  accessToken: string,
  lead: Lead
): Promise<GoogleEvent> {
  if (!canSchedule(lead)) {
    throw new Error("Lead has no valid scheduled_day (YYYY-MM-DD).");
  }
  const times = buildStartEnd(lead.scheduled_day!, lead.scheduled_time);
  if (!times) throw new Error("Invalid scheduled_day.");

  const body = {
    summary: calendarEventTitle({
      first_name: lead.first_name,
      last_name: lead.last_name,
      zip: lead.zip,
      phone_number: lead.phone_number,
      email: lead.email,
    }),
    description: buildDescription(lead),
    location: buildLocation(lead),
    ...times,
    // Idempotency: reuse lead.id as source.title so the same lead never
    // creates two distinct events in a user's calendar.
    extendedProperties: {
      private: { leadId: lead.id },
    },
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new Error(`Google Calendar create failed: ${res.status} ${await res.text()}`);
  }
  const evt = (await res.json()) as GoogleEvent;
  return evt;
}

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<void> {
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
}
