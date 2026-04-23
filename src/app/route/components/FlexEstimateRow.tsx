"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
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
import { LEAD_FLEX_WINDOW_DISPLAY } from "@/lib/types";
import { formatDateLong, type FlexStop } from "../route-helpers";

/**
 * Row in the Estimates list for a flex-window lead. Shares the general
 * layout of EstimateRow (address, sales person, action icons) but:
 *   - displays "Flex — All Day / AM / PM" where the start time would be,
 *   - has no drive-leg pill (flex stops aren't sequenced),
 *   - carries no numbered badge (the purple "F" badge makes it visually
 *     distinct from the numbered timed stops above it).
 *
 * Tapping the flex label opens the reschedule panel so the operator can
 * pin a specific time; setting one will move the stop into the timed
 * list on the next reload.
 */
export function FlexEstimateRow({
  stop,
  date,
  onFlash,
  onReload,
}: {
  stop: FlexStop;
  date: string;
  onFlash: (msg: string) => void;
  onReload: () => void;
}) {
  const router = useRouter();
  const { settings } = useAppSettings();
  const confirmDialog = useConfirm();
  const [completing, setCompleting] = useState(false);

  const flexLabel = LEAD_FLEX_WINDOW_DISPLAY[stop.flexWindow];

  function openReschedule() {
    router.push(`/route?scheduleLead=${stop.id}&day=${date}`);
  }

  const telHref = stop.phoneNumber
    ? `tel:${stop.phoneNumber.replace(/[^\d+]/g, "")}`
    : null;
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
      // Flex leads have no pinned time yet — surface the window itself
      // rather than a blank so a confirmation SMS is still meaningful.
      time: flexLabel,
    });
    return `sms:${digits}?body=${encodeURIComponent(body)}`;
  }, [
    stop.phoneNumber,
    stop.firstName,
    stop.label,
    stop.salesPerson,
    flexLabel,
    date,
    settings,
  ]);
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    stop.address
  )}`;

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
        onFlash(formatLeadPatchError(res, json, `Failed to mark complete (${res.status})`));
        if (res.status === 409) onReload();
        return;
      }
      onFlash(`Marked "${stop.label}" complete`);
      onReload();
    } catch (e) {
      onFlash((e as Error).message || "Failed to mark complete");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex flex-col items-center gap-1 w-10 pt-0.5">
          <div
            className="flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/30"
            title="Flex — no time assigned yet"
          >
            F
          </div>
          <button
            type="button"
            onClick={openReschedule}
            title="Assign a time"
            aria-label={`Assign a time to ${stop.label}`}
            className="text-[10px] font-semibold text-[var(--accent)] hover:underline decoration-dotted underline-offset-2 text-center leading-tight whitespace-nowrap"
          >
            {flexLabel}
          </button>
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
            {stop.salesPerson ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 h-5 text-[11px] text-[var(--fg)]">
                <User className="h-3 w-3" /> {stop.salesPerson}
              </span>
            ) : null}
          </div>
        </div>
      </div>

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
          href={`/leads?lead=${stop.id}`}
          aria-label={`Open ${stop.label}`}
          className="ml-auto inline-flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)]"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </li>
  );
}
