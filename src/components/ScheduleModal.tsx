"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, CalendarCheck, AlertTriangle, Sparkles } from "lucide-react";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

type Half = "all" | "morning" | "afternoon";

type Slot = {
  startTime: string;
  endTime: string;
  driveMinutesBefore: number;
  driveMinutesAfter: number;
  totalDriveMinutes: number;
  reasoning: { priorLabel: string | null; nextLabel: string | null };
};

export default function ScheduleModal({
  lead,
  onClose,
  onBooked,
}: {
  lead: Lead;
  onClose: () => void;
  onBooked: (updatedLead: Lead, htmlLink?: string) => void;
}) {
  const [half, setHalf] = useState<Half>("all");
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, half }),
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
  }, [lead.id, half]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function book(slot: Slot) {
    setBooking(slot.startTime);
    setError(null);
    try {
      const patchRes = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_time: slot.startTime }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchJson.error ?? "Failed to set time");

      const calRes = await fetch(`/api/leads/${lead.id}/calendar`, { method: "POST" });
      const calJson = await calRes.json();
      if (calRes.status === 428) {
        // Google Calendar not connected — offer to connect.
        if (confirm("Google Calendar is not connected. Connect now?")) {
          window.location.href = calJson.connectUrl;
        }
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
      onBooked(updated, calJson.htmlLink);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(null);
    }
  }

  const day = lead.scheduled_day ?? "";
  const dayLabel = formatDayLabel(day);
  const leadName = lead.client?.trim() || "this lead";

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
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" /> AI Schedule
            </div>
            <div className="font-semibold truncate">
              {leadName} · {dayLabel}
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
            slots.map((s, i) => (
              <SlotRow
                key={`${s.startTime}-${i}`}
                slot={s}
                rank={i}
                busy={booking === s.startTime}
                disabled={Boolean(booking)}
                onBook={() => book(s)}
              />
            ))
          )}
          {!loading && warnings.length > 0 && slots.length > 0 && (
            <div className="text-[11px] text-[var(--muted)] px-1">{warnings[0]}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  rank,
  busy,
  disabled,
  onBook,
}: {
  slot: Slot;
  rank: number;
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
        rank === 0 ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-white"
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
          rank === 0
            ? "bg-[var(--accent)] text-white hover:opacity-95"
            : "bg-white border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--surface-2)]",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
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
