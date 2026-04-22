"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Car,
  CheckCircle2,
  ChevronRight,
  Home as HomeIcon,
  Loader2,
  MessageSquare,
  Navigation,
  Phone,
  User,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatClock, type Stop } from "../route-helpers";

type Mode = "normal" | "reorder" | "preview";

export function EstimateRow({
  stop,
  index,
  date,
  mode = "normal",
  canUp,
  canDown,
  onReorderUp,
  onReorderDown,
  reorderBusy,
  onReload,
  onFlash,
}: {
  stop: Stop;
  index: number;
  date: string;
  mode?: Mode;
  canUp?: boolean;
  canDown?: boolean;
  onReorderUp?: () => void;
  onReorderDown?: () => void;
  reorderBusy?: boolean;
  onReload?: () => void;
  onFlash?: (msg: string) => void;
}) {
  const confirmDialog = useConfirm();
  const [completing, setCompleting] = useState(false);

  const telHref = stop.phoneNumber
    ? `tel:${stop.phoneNumber.replace(/[^\d+]/g, "")}`
    : null;
  const smsHref = stop.phoneNumber
    ? `sms:${stop.phoneNumber.replace(/[^\d+]/g, "")}`
    : null;
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    stop.address
  )}`;

  // First stop's drive leg starts at Home; subsequent rows measure the leg
  // from the previous stop. null means the server couldn't compute a leg
  // (e.g. no home address configured).
  const isFirst = index === 1;
  const driveLabel =
    stop.driveMinutesFromPrev === null
      ? null
      : isFirst
        ? `${stop.driveMinutesFromPrev} min from home`
        : `${stop.driveMinutesFromPrev} min drive`;

  async function handleMarkComplete() {
    const ok = await confirmDialog({
      title: "Mark complete?",
      message: `Mark "${stop.label}" as completed. It will be removed from today's route and the calendar event will be deleted.`,
      confirmLabel: "Mark complete",
    });
    if (!ok) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/leads/${stop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Completed" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFlash?.(json.error ?? `Failed to mark complete (${res.status})`);
        return;
      }
      onFlash?.(`Marked "${stop.label}" complete`);
      onReload?.();
    } catch (e) {
      onFlash?.((e as Error).message || "Failed to mark complete");
    } finally {
      setCompleting(false);
    }
  }

  const highlight =
    mode === "preview"
      ? "bg-amber-50 border-l-2 border-amber-400 -mx-4 px-4"
      : mode === "reorder"
        ? "-mx-4 px-4"
        : "";

  // Kept in the signature because several call sites already pass it and
  // future row-level actions (e.g. reschedule-to-tomorrow) will need it.
  void date;

  return (
    <li className={`py-3 first:pt-0 last:pb-0 ${highlight}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex flex-col items-center gap-1 w-10 pt-0.5">
          <div
            className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold tabular-nums ${
              mode === "preview"
                ? "bg-amber-500 text-white"
                : "bg-[var(--accent)] text-white"
            }`}
          >
            {index}
          </div>
          <div className="text-[10px] tabular-nums text-[var(--muted)]">
            {formatClock(stop.startTime)}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/leads?lead=${stop.id}`}
            className="block min-w-0 group"
          >
            <div className="font-medium truncate group-hover:underline">
              {stop.label}
            </div>
            <div className="text-xs text-[var(--muted)] truncate">
              {stop.address}
            </div>
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {driveLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 h-5 text-[11px] text-[var(--muted)]">
                {isFirst ? (
                  <HomeIcon className="h-3 w-3" />
                ) : (
                  <Car className="h-3 w-3" />
                )}
                {driveLabel}
              </span>
            )}
            {stop.salesPerson ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 h-5 text-[11px] text-[var(--fg)]">
                <User className="h-3 w-3" /> {stop.salesPerson}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {mode === "reorder" ? (
            <>
              <button
                onClick={onReorderUp}
                disabled={!canUp || reorderBusy}
                aria-label={`Move ${stop.label} up`}
                className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                onClick={onReorderDown}
                disabled={!canDown || reorderBusy}
                aria-label={`Move ${stop.label} down`}
                className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </>
          ) : mode === "preview" ? (
            <Link
              href={`/leads?lead=${stop.id}`}
              aria-label={`Open ${stop.label}`}
              className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <button
                onClick={handleMarkComplete}
                disabled={completing}
                aria-label={`Mark ${stop.label} complete`}
                title="Mark complete"
                className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/5 text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-60"
              >
                {completing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
              </button>
              {telHref && (
                <a
                  href={telHref}
                  aria-label={`Call ${stop.label}`}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
              {smsHref && (
                <a
                  href={smsHref}
                  aria-label={`Text ${stop.label}`}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
                >
                  <MessageSquare className="h-4 w-4" />
                </a>
              )}
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                aria-label={`Navigate to ${stop.address}`}
                className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
              >
                <Navigation className="h-4 w-4" />
              </a>
              <Link
                href={`/leads?lead=${stop.id}`}
                aria-label={`Open ${stop.label}`}
                className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
