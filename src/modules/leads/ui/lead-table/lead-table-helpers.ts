import type { Lead } from "@/modules/leads/model";
import {
  renderTemplate,
  smsIntroTemplate,
  smsEnrouteTemplate,
  emailSubjectTemplate,
  emailBodyTemplate,
  type TemplateVars,
} from "@/lib/templates";
import type { ClientAppSettings } from "@/lib/client-settings";

/** Variable bag consumed by `renderTemplate`. Centralized so all
 *  channels (SMS intro, SMS confirm, email) see the same values. */
export function templateVars(lead: Lead, settings: ClientAppSettings): TemplateVars {
  const first =
    (lead.first_name ?? "").trim() ||
    (lead.client ?? "").trim().split(" ")[0] ||
    "there";
  return {
    firstName: first,
    lastName: (lead.last_name ?? "").trim(),
    client: (lead.client ?? "").trim(),
    // Fall back to the configured default_salesperson when the lead
    // has none assigned so {salesPerson} in templates doesn't render
    // as the literal placeholder.
    salesPerson:
      (lead.sales_person ?? "").trim() ||
      (settings.default_salesperson ?? "").trim(),
    companyName: (settings.company_name ?? "").trim(),
    companyPhone: (settings.company_phone ?? "").trim(),
    companyEmail: (settings.company_email ?? "").trim(),
    day: formatDayHuman(lead.scheduled_day),
    time: formatTimeHuman(lead.scheduled_time),
  };
}

/**
 * Build the sms: link for a lead's first-touch text. Uses the user's
 * configured SMS intro template with `{firstName}`, `{salesPerson}`, and
 * company-name placeholder substitution.
 *
 * iOS and Android both honor `sms:<number>?body=<urlencoded>`.
 */
export function buildSmsHref(phone: string, lead: Lead, settings: ClientAppSettings): string {
  const body = renderTemplate(smsIntroTemplate(settings), templateVars(lead, settings));
  return `sms:${phone}?body=${encodeURIComponent(body)}`;
}

/**
 * Build the sms: link for the "on my way" text. Same placeholder set as
 * the intro template but rendered against the en-route template the
 * user configured in Settings.
 */
export function buildEnrouteSmsHref(phone: string, lead: Lead, settings: ClientAppSettings): string {
  const body = renderTemplate(smsEnrouteTemplate(settings), templateVars(lead, settings));
  return `sms:${phone}?body=${encodeURIComponent(body)}`;
}

/** Build the mailto: href — subject + body come from the user's
 *  configured email template. */
export function buildMailtoHref(email: string, lead: Lead, settings: ClientAppSettings): string {
  const vars = templateVars(lead, settings);
  const subject = renderTemplate(emailSubjectTemplate(settings), vars);
  const body = renderTemplate(emailBodyTemplate(settings), vars);
  // RFC 6068 requires percent-encoding for mailto: query components.
  // URLSearchParams uses `application/x-www-form-urlencoded` (spaces as `+`),
  // which Apple Mail renders as literal `+` characters in the body.
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Build a Google Maps navigation link for the lead's address.
 * Works on both iOS (opens Apple Maps or Google Maps) and Android.
 */
export function buildNavigationHref(lead: Lead): string | undefined {
  const parts = [lead.address, lead.city, lead.state, lead.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const q = encodeURIComponent(parts.join(", "));
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export function formatDateHuman(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/**
 * Human-friendly schedule display for the compact confirmation strip.
 * Handles day + time, day + flex window, and day-only states.
 */
export function formatScheduleDisplay(
  day: string | null,
  time: string | null,
  flexWindow: Lead["flex_window"]
): string {
  if (!day) return time ? `Time: ${formatTime12(time)}` : "Not scheduled";
  const d = new Date(day + "T12:00:00");
  const dayStr = isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (time) return `${dayStr} · ${formatTime12(time)}`;
  if (flexWindow) {
    const labels: Record<string, string> = {
      all_day: "All Day",
      am: "AM",
      pm: "PM",
    };
    return `${dayStr} · Flex ${labels[flexWindow] ?? flexWindow}`;
  }
  return dayStr;
}

/** "2026-06-17" → "Wed, Jun 17" (or "Wed, Jun 17, 2028" for other years). */
function formatDayHuman(day: string | null | undefined): string {
  if (!day) return "";
  const d = new Date(day + "T12:00:00");
  if (isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** "14:00:00" → "2:00 PM". */
function formatTimeHuman(time: string | null | undefined): string {
  if (!time) return "";
  return formatTime12(time);
}

function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export type FieldDef = {
  key: keyof Lead;
  label: string;
  type?: "text" | "date" | "time" | "textarea" | "tel" | "email";
  placeholder?: string;
  inputMode?: "text" | "tel" | "email" | "numeric";
};
