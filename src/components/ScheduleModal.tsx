"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Loader2,
  CalendarCheck,
  AlertTriangle,
  Sparkles,
  ChevronLeft,
  MessageSquare,
  ExternalLink,
  Check,
} from "lucide-react";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { useAppSettings } from "@/components/SettingsProvider";
import { renderTemplate, smsConfirmTemplate } from "@/lib/templates";

type Half = "all" | "morning" | "afternoon";

type Slot = {
  startTime: string;
  endTime: string;
  driveMinutesBefore: number;
  driveMinutesAfter: number;
  totalDriveMinutes: number;
  reasoning: { priorLabel: string | null; nextLabel: string | null };
};

type DayPreview =
  | {
      date: string;
      isWorkDay: true;
      bestTotalDriveMinutes: number | null;
      slotCount: number;
    }
  | { date: string; isWorkDay: false };

export default function ScheduleModal({
  lead,
  onClose,
  onBooked,
}: {
  lead: Lead;
  onClose: () => void;
  onBooked: (updatedLead: Lead, htmlLink?: string) => void;
}) {
  const { toast } = useToast();
  // Path A vs Path B is determined by whether the lead already has a day.
  // Once in the modal, the user can also jump back from Path A's day view
  // to the week picker to override the customer's requested day.
  const [selectedDay, setSelectedDay] = useState<string | null>(
    lead.scheduled_day ?? null
  );
  const [view, setView] = useState<"week" | "day">(
    lead.scheduled_day ? "day" : "week"
  );

  const [half, setHalf] = useState<Half>("all");
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [weekLoading, setWeekLoading] = useState(false);
  const [weekDays, setWeekDays] = useState<DayPreview[]>([]);
  const [weekError, setWeekError] = useState<string | null>(null);

  // When set, the modal flips from the day ranking to a success view with
  // the option to text the customer an appointment confirmation.
  const [booked, setBooked] = useState<{
    day: string;
    time: string;
    htmlLink?: string;
  } | null>(null);

  const loadWeek = useCallback(async () => {
    setWeekLoading(true);
    setWeekError(null);
    try {
      const res = await fetch("/api/schedule/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setWeekError(json.error ?? `Failed (${res.status})`);
        setWeekDays([]);
      } else {
        setWeekDays(json.days ?? []);
      }
    } catch (e) {
      setWeekError((e as Error).message || "Network error");
    } finally {
      setWeekLoading(false);
    }
  }, [lead.id]);

  const loadSlots = useCallback(async () => {
    if (!selectedDay) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, half, day: selectedDay }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        setSlots([]);
        setWarnings([]);
      } else {
        setSlots(json.slots ?? []);
        setWarnings(json.warnings ?? []);
      }
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [lead.id, half, selectedDay]);

  useEffect(() => {
    if (view === "week") loadWeek();
  }, [view, loadWeek]);

  useEffect(() => {
    if (view === "day") loadSlots();
  }, [view, loadSlots]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function book(slot: Slot) {
    if (!selectedDay) return;
    setBooking(slot.startTime);
    setError(null);
    try {
      // Path B may need to set scheduled_day too; always include it so the
      // lead record is authoritative before we call the calendar endpoint.
      const patchBody: Record<string, string> = {
        scheduled_time: slot.startTime,
        scheduled_day: selectedDay,
      };
      const patchRes = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchJson.error ?? "Failed to set time");

      const calRes = await fetch(`/api/leads/${lead.id}/calendar`, { method: "POST" });
      const calJson = await calRes.json();
      if (calRes.status === 428) {
        toast({
          kind: "info",
          message: "Google Calendar isn't connected.",
          duration: 6000,
          action: {
            label: "Connect",
            onClick: () => {
              window.location.href = calJson.connectUrl;
            },
          },
        });
        return;
      }
      if (!calRes.ok) throw new Error(calJson.error ?? "Calendar sync failed");

      // Re-fetch so the UI reflects status=Scheduled and calendar_event_id,
      // which the calendar endpoint writes but the earlier PATCH response
      // doesn't include.
      const freshRes = await fetch(`/api/leads`);
      let updated: Lead = patchJson.lead as Lead;
      if (freshRes.ok) {
        const freshJson = await freshRes.json();
        const found = (freshJson.leads as Lead[]).find((l) => l.id === lead.id);
        if (found) updated = found;
      }
      // Fire the parent update so the leads list and today's route refresh
      // immediately, then flip the modal to the SMS confirm step instead of
      // closing. The user closes manually when they're done with the text.
      onBooked(updated, calJson.htmlLink);
      setBooked({
        day: selectedDay,
        time: slot.startTime,
        htmlLink: calJson.htmlLink,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(null);
    }
  }

  const leadName = lead.client?.trim() || "this lead";

  const headerTitle = useMemo(() => {
    if (booked) return `${leadName} · Booked`;
    if (view === "week") return `${leadName} · Pick a day`;
    return `${leadName} · ${formatDayLabel(selectedDay ?? "")}`;
  }, [booked, view, leadName, selectedDay]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 min-w-0">
            {view === "day" && !booked && (
              <button
                onClick={() => setView("week")}
                aria-label="Back to week picker"
                className="inline-flex items-center justify-center h-9 w-9 -ml-1 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" /> AI Schedule
              </div>
              <div className="font-semibold truncate">{headerTitle}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center h-10 w-10 -mr-2 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {booked ? (
          <BookedView
            lead={lead}
            day={booked.day}
            time={booked.time}
            htmlLink={booked.htmlLink}
            onDone={onClose}
          />
        ) : view === "week" ? (
          <WeekView
            days={weekDays}
            loading={weekLoading}
            error={weekError}
            onPick={(d) => {
              setSelectedDay(d);
              setView("day");
            }}
          />
        ) : (
          <DayView
            half={half}
            setHalf={setHalf}
            loading={loading}
            error={error}
            slots={slots}
            warnings={warnings}
            booking={booking}
            onBook={book}
          />
        )}
      </div>
    </div>
  );
}

function WeekView({
  days,
  loading,
  error,
  onPick,
}: {
  days: DayPreview[];
  loading: boolean;
  error: string | null;
  onPick: (date: string) => void;
}) {
  const bestMinutes = useMemo(() => {
    const costs = days
      .filter((d): d is Extract<DayPreview, { isWorkDay: true }> => d.isWorkDay)
      .map((d) => d.bestTotalDriveMinutes)
      .filter((c): c is number => c != null);
    return costs.length ? Math.min(...costs) : null;
  }, [days]);

  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center text-[var(--muted)]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Pricing each day…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-4">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="text-xs text-[var(--muted)] mb-2">
        Days ranked by drive time cost. Greener = less driving.
      </div>
      <div className="grid grid-cols-1 gap-2">
        {days.map((d) => (
          <DayRow
            key={d.date}
            day={d}
            bestOverall={bestMinutes}
            onPick={() => d.isWorkDay && onPick(d.date)}
          />
        ))}
      </div>
    </div>
  );
}

function DayRow({
  day,
  bestOverall,
  onPick,
}: {
  day: DayPreview;
  bestOverall: number | null;
  onPick: () => void;
}) {
  const label = formatDayLabel(day.date);

  if (!day.isWorkDay) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 flex items-center justify-between opacity-60">
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-[var(--muted)]">Day off</div>
        </div>
      </div>
    );
  }

  const cost = day.bestTotalDriveMinutes;
  const noFit = cost == null;
  const isBest = cost != null && cost === bestOverall;

  return (
    <button
      onClick={onPick}
      disabled={noFit}
      className={cn(
        "w-full text-left rounded-xl border px-3 py-2.5 flex items-center justify-between transition active:scale-[0.99]",
        noFit
          ? "border-[var(--border)] bg-[var(--surface-2)] opacity-60 cursor-not-allowed"
          : isBest
          ? "border-[var(--accent)] bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"
      )}
    >
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">
          {noFit
            ? "No feasible slots"
            : day.slotCount === 1
            ? "1 slot available"
            : `${day.slotCount} slots available`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {cost != null && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
              isBest
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--fg)]"
            )}
          >
            +{cost} min
          </span>
        )}
      </div>
    </button>
  );
}

function DayView({
  half,
  setHalf,
  loading,
  error,
  slots,
  warnings,
  booking,
  onBook,
}: {
  half: Half;
  setHalf: (h: Half) => void;
  loading: boolean;
  error: string | null;
  slots: Slot[];
  warnings: string[];
  booking: string | null;
  onBook: (s: Slot) => void;
}) {
  // Rank order is preserved by lowest totalDriveMinutes; highlight the best.
  const bestCost = slots.length
    ? Math.min(...slots.map((s) => s.totalDriveMinutes))
    : null;

  return (
    <>
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1 w-full">
          {(["morning", "afternoon", "all"] as Half[]).map((h) => (
            <button
              key={h}
              onClick={() => setHalf(h)}
              className={cn(
                "flex-1 h-9 rounded-lg text-sm font-medium capitalize transition-colors",
                half === h
                  ? "bg-white shadow text-[var(--fg)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              )}
            >
              {h === "all" ? "All day" : h}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="py-10 flex items-center justify-center text-[var(--muted)]">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Ranking slots…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2.5 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : slots.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted)]">
            {warnings[0] ?? "No feasible slots."}
          </div>
        ) : (
          slots.map((s) => (
            <SlotRow
              key={s.startTime}
              slot={s}
              isBest={s.totalDriveMinutes === bestCost}
              busy={booking === s.startTime}
              disabled={Boolean(booking)}
              onBook={() => onBook(s)}
            />
          ))
        )}
        {!loading && warnings.length > 0 && slots.length > 0 && (
          <div className="text-[11px] text-[var(--muted)] px-1">{warnings[0]}</div>
        )}
      </div>
    </>
  );
}

function SlotRow({
  slot,
  isBest,
  busy,
  disabled,
  onBook,
}: {
  slot: Slot;
  isBest: boolean;
  busy: boolean;
  disabled: boolean;
  onBook: () => void;
}) {
  const label = clockFromHHMM(slot.startTime);
  const lines: string[] = [];
  if (slot.reasoning.priorLabel) {
    lines.push(`${slot.driveMinutesBefore} min ${slot.reasoning.priorLabel}`);
  }
  if (slot.reasoning.nextLabel) {
    lines.push(`${slot.driveMinutesAfter} min ${slot.reasoning.nextLabel}`);
  } else {
    lines.push("last job of day");
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-3 flex items-center gap-3",
        isBest
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-white"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{label}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
          {lines.join(" · ")}
        </div>
      </div>
      <button
        onClick={onBook}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-sm font-semibold whitespace-nowrap transition active:scale-[0.98]",
          isBest
            ? "bg-[var(--accent)] text-white hover:opacity-95"
            : "bg-white border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--surface-2)]",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CalendarCheck className="h-4 w-4" />
        )}
        {busy ? "Booking…" : "Book"}
      </button>
    </div>
  );
}

function clockFromHHMM(t: string): string {
  const m = t.match(/^(\d{2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${min} ${ampm}`;
}

function formatDayLabel(iso: string): string {
  if (!iso) return "";
  // Parse as local calendar date, not UTC, so "2026-05-01" doesn't read "Apr 30".
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatLongDayLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Strip everything that isn't a digit or +; the sms: handler is picky. */
function sanitizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const cleaned = p.replace(/[^\d+]/g, "");
  return cleaned.length >= 7 ? cleaned : null;
}

function firstName(lead: Lead): string {
  return (
    lead.first_name?.trim() ||
    lead.client?.trim().split(/\s+/)[0] ||
    "there"
  );
}

function BookedView({
  lead,
  day,
  time,
  htmlLink,
  onDone,
}: {
  lead: Lead;
  day: string;
  time: string;
  htmlLink?: string;
  onDone: () => void;
}) {
  const { settings } = useAppSettings();
  const phone = sanitizePhone(lead.phone_number);
  const dayLabel = formatLongDayLabel(day);
  const timeLabel = clockFromHHMM(time);
  const message = renderTemplate(smsConfirmTemplate(settings), {
    firstName: firstName(lead),
    lastName: (lead.last_name ?? "").trim(),
    client: (lead.client ?? "").trim(),
    salesPerson: (lead.sales_person ?? "").trim(),
    companyName: (settings.company_name ?? "").trim(),
    companyPhone: (settings.company_phone ?? "").trim(),
    companyEmail: (settings.company_email ?? "").trim(),
    day: dayLabel,
    time: timeLabel,
  });
  // Matches the format used by the SMS button on the lead card — "?body="
  // works on both iPhone and Android (see LeadTable.buildSmsHref).
  const smsHref = phone
    ? `sms:${phone}?body=${encodeURIComponent(message)}`
    : null;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
      <div className="flex flex-col items-center text-center gap-2">
        <div className="h-14 w-14 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
          <Check className="h-7 w-7" />
        </div>
        <div className="text-lg font-semibold">Booked</div>
        <div className="text-sm text-[var(--muted)]">
          {dayLabel} at {timeLabel}
        </div>
      </div>

      <div className="space-y-2">
        {smsHref ? (
          <a
            href={smsHref}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl h-12 px-4 text-sm font-semibold bg-[var(--accent)] text-white hover:opacity-95 active:scale-[0.98]"
          >
            <MessageSquare className="h-4 w-4" />
            Text confirmation
          </a>
        ) : (
          <div className="text-xs text-[var(--muted)] text-center">
            No phone number on this lead — add one to text a confirmation.
          </div>
        )}

        {htmlLink && (
          <a
            href={htmlLink}
            target="_blank"
            rel="noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl h-11 px-4 text-sm font-medium bg-white border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ExternalLink className="h-4 w-4" />
            Open in Google Calendar
          </a>
        )}

        <button
          onClick={onDone}
          className="w-full inline-flex items-center justify-center h-11 px-4 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]"
        >
          Done
        </button>
      </div>

      {smsHref && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-xs text-[var(--muted)] leading-relaxed">
          Preview: {message}
        </div>
      )}
    </div>
  );
}
