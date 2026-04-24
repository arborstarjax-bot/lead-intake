"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import { useAppSettings } from "@/components/SettingsProvider";
import { renderTemplate, smsConfirmTemplate } from "@/lib/templates";
import { formatLeadPatchError, patchLead } from "@/modules/offline";
import { formatClock, formatDateLong, type Stop } from "../route-helpers";

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
  const router = useRouter();
  const { settings } = useAppSettings();
  const [completing, setCompleting] = useState(false);

  function openReschedule() {
    // Navigating with ?scheduleLead pops the SchedulePanel for this stop on
    // the current day. The panel's "Find best day & time" button can then
    // swap the ghost day for any other day in the horizon.
    router.push(`/route?scheduleLead=${stop.id}&day=${date}`);
  }

  const telHref = stop.phoneNumber
    ? `tel:${stop.phoneNumber.replace(/[^\d+]/g, "")}`
    : null;
  // Populate the SMS body with the user's configured appointment-confirmation
  // template so tapping Text from the route list opens Messages with the
  // message already drafted — previously this was a bare `sms:` link with
  // no body, which looked like a bug in the route timeline.
  const smsHref = useMemo(() => {
    if (!stop.phoneNumber) return null;
    const digits = stop.phoneNumber.replace(/[^\d+]/g, "");
    const body = renderTemplate(smsConfirmTemplate(settings), {
      firstName: stop.firstName?.trim() || "there",
      lastName: "",
      client: stop.label,
      salesPerson:
        stop.salesPerson?.trim() ||
        settings.default_salesperson?.trim() ||
        settings.salespeople?.[0]?.trim() ||
        "",
      companyName: (settings.company_name ?? "").trim(),
      companyPhone: (settings.company_phone ?? "").trim(),
      companyEmail: (settings.company_email ?? "").trim(),
      day: formatDateLong(date),
      time: formatClock(stop.startTime),
    });
    return `sms:${digits}?body=${encodeURIComponent(body)}`;
  }, [
    stop.phoneNumber,
    stop.firstName,
    stop.label,
    stop.salesPerson,
    stop.startTime,
    date,
    settings,
  ]);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    stop.address
  )}`;

  // First stop's drive leg starts at Home; subsequent rows measure the leg
  // from the previous stop. null means the server couldn't compute a leg
  // (e.g. no home address configured).
  const isFirst = index === 1;
  const driveLabel = (() => {
    if (stop.driveMinutesFromPrev === null) return null;
    const min = stop.driveMinutesFromPrev;
    const mi = stop.distanceMilesFromPrev;
    // Distance is informative only when the server returned it; fall back
    // to minutes-only so we don't print "— mi" when Distance Matrix is out.
    const distance = mi != null && mi > 0 ? `${mi} mi · ` : "";
    return isFirst
      ? `${distance}${min} min from home`
      : `${distance}${min} min from prev stop`;
  })();

  async function handleMarkComplete() {
    const ok = await confirmDialog({
      title: "Mark complete?",
      message: `Mark "${stop.label}" as completed. It will be removed from today's route and the calendar event will be deleted.`,
      confirmLabel: "Mark complete",
    });
    if (!ok) return;
    setCompleting(true);
    try {
      const res = await patchLead(
        stop.id,
        { status: "Completed" },
        { updated_at: stop.updatedAt }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFlash?.(formatLeadPatchError(res, json, `Failed to mark complete (${res.status})`));
        // Refresh on 409 so the user sees the stop's current state.
        if (res.status === 409) onReload?.();
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

  // The main row: [index/time | name+address+chips | trailing control].
  // On narrow mobile screens the action buttons previously crammed in
  // beside the name and wrapped the drive-time pill into the icons. We
  // now put the full action cluster on its own line below the content,
  // which keeps the name column wide and prevents overlap. In reorder /
  // preview modes the trailing control stays inline since it's a single
  // compact unit.
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
          {mode === "normal" ? (
            <button
              type="button"
              onClick={openReschedule}
              title="Reschedule"
              aria-label={`Reschedule ${stop.label}`}
              className="text-[10px] tabular-nums text-[var(--muted)] hover:text-[var(--accent)] hover:underline decoration-dotted underline-offset-2"
            >
              {formatClock(stop.startTime)}
            </button>
          ) : (
            <div className="text-[10px] tabular-nums text-[var(--muted)]">
              {formatClock(stop.startTime)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/leads/${stop.id}`}
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
        {/* Trailing control stays inline only for reorder / preview modes,
           where it's a tight 1-2 button cluster that won't crush the name. */}
        {mode === "reorder" && (
          <div className="flex items-center gap-1 shrink-0">
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
          </div>
        )}
        {mode === "preview" && (
          <Link
            href={`/leads/${stop.id}`}
            aria-label={`Open ${stop.label}`}
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* Action strip sits on its own row on mobile so the name/address
         column stays full-width above and the buttons never squeeze text
         into wrapping. On sm+ the row has plenty of width. */}
      {mode === "normal" && (
        <div className="mt-2 pl-[52px] flex items-center gap-1.5 flex-wrap">
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
            href={`/leads/${stop.id}`}
            aria-label={`Open ${stop.label}`}
            className="ml-auto inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </li>
  );
}
