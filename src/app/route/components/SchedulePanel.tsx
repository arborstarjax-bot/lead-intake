"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck,
  ChevronRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  formatClock,
  formatDateLong,
  handleCalendarDisconnected,
  type Half,
  type Slot,
} from "../route-helpers";
import { HalfTabs } from "./HalfTabs";

export function SchedulePanel({
  leadId,
  leadLabel,
  selectedDay,
  previewSlot,
  onPreview,
  onHeightChange,
  onBooked,
}: {
  leadId: string;
  leadLabel: string;
  selectedDay: string;
  previewSlot: Slot | null;
  onPreview: (slot: Slot | null) => void;
  onHeightChange: (h: number) => void;
  onBooked: (msg: string) => void;
}) {
  // Report the panel's rendered height to the parent so it can reserve
  // matching bottom padding and keep the Timeline visible above the fixed
  // panel. The height grows when slots load, when the Confirm bar appears,
  // or when the viewport gets narrower — ResizeObserver catches all three.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      onHeightChange(Math.ceil(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);
  const [half, setHalf] = useState<Half>("all");
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const confirmDialog = useConfirm();

  const loadSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, half, day: selectedDay }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Failed (${res.status})`);
        setSlots([]);
        setWarnings([]);
        return;
      }
      setSlots(json.slots ?? []);
      setWarnings(json.warnings ?? []);
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [leadId, half, selectedDay]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // Drop any preview when the half-day filter changes. Otherwise the
  // "Confirm & book 2:00 PM" bar would still sit under a list that no
  // longer includes that slot (e.g. filtered to AM) and the map would
  // keep drawing the stale amber overlay.
  useEffect(() => {
    onPreview(null);
    // Intentionally only reacting to `half`. onPreview is a stable setter
    // and including it would clear the preview on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [half]);

  async function book() {
    if (!previewSlot) return;
    setBooking(true);
    setError(null);
    try {
      const patchRes = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_time: previewSlot.startTime,
          scheduled_day: selectedDay,
        }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) {
        throw new Error(patchJson.error ?? "Failed to set time");
      }
      const calRes = await fetch(`/api/leads/${leadId}/calendar`, { method: "POST" });
      const calJson = await calRes.json();
      if (await handleCalendarDisconnected(calRes, calJson, confirmDialog)) return;
      if (!calRes.ok) throw new Error(calJson.error ?? "Calendar sync failed");
      onBooked(`Booked ${leadLabel} at ${formatClock(previewSlot.startTime)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  return (
    <div
      ref={panelRef}
      // Sit above the mobile BottomNav (z-40) so Confirm & book / Cancel
      // always stay tappable. On md+ the BottomNav is hidden, so the panel
      // returns to bottom-0.
      className="fixed inset-x-0 z-50 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:bottom-0 border-t border-[var(--border)] bg-white shadow-2xl rounded-t-2xl"
    >
      <div className="mx-auto max-w-6xl px-4 py-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)] flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" /> Ranked slots
            </div>
            <div className="font-semibold truncate">
              {formatDateLong(selectedDay)}
            </div>
          </div>
          <HalfTabs half={half} setHalf={setHalf} />
        </div>

        {warnings.length > 0 && !loading && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {warnings.join(" · ")}
          </div>
        )}

        {error && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-6 flex items-center justify-center text-[var(--muted)] text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Ranking slots…
          </div>
        ) : slots.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--muted)]">
            No feasible slots on this day.
          </div>
        ) : (
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {slots.map((s) => {
              const selected = previewSlot?.startTime === s.startTime;
              return (
                <button
                  key={s.startTime}
                  onClick={() => onPreview(selected ? null : s)}
                  disabled={booking}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                    selected
                      ? "border-amber-400 bg-amber-50 ring-2 ring-amber-200"
                      : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{formatClock(s.startTime)}</div>
                    <div className="text-xs text-[var(--muted)] truncate">
                      {[s.reasoning.priorLabel, s.reasoning.nextLabel]
                        .filter(Boolean)
                        .join(" · ") || "Open slot"}
                      {" · "}
                      {s.totalDriveMinutes} min driving
                    </div>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 transition",
                      selected
                        ? "text-amber-600 rotate-90"
                        : "text-[var(--muted)]"
                    )}
                  />
                </button>
              );
            })}
          </div>
        )}

        {previewSlot && (
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onPreview(null)}
              disabled={booking}
              className="rounded-full border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)] px-4 h-10 text-sm font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={book}
              disabled={booking}
              className="flex-1 rounded-full bg-[var(--accent)] text-white h-10 text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {booking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Booking…
                </>
              ) : (
                <>
                  <CalendarCheck className="h-4 w-4" />
                  Confirm &amp; book {formatClock(previewSlot.startTime)}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
