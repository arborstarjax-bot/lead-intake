"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MessageSquare,
  Navigation,
  Phone,
  User,
} from "lucide-react";
import { useAppSettings } from "@/components/SettingsProvider";
import { formatLeadPatchError, patchLead } from "@/modules/offline";
import { LEAD_FLEX_WINDOW_DISPLAY, type LeadPatch } from "@/modules/leads/model";
import { EstimateOutcomeModal, SmsPickerModal, type SmsTemplateVars } from "@/modules/leads";
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
  const [completing, setCompleting] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [showSmsPicker, setShowSmsPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const flexLabel = LEAD_FLEX_WINDOW_DISPLAY[stop.flexWindow];

  function openReschedule() {
    router.push(`/route?scheduleLead=${stop.id}&day=${date}`);
  }

  const telHref = stop.phoneNumber
    ? `tel:${stop.phoneNumber.replace(/[^\d+]/g, "")}`
    : null;
  const smsVars = useMemo<SmsTemplateVars>(() => ({
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
    time: flexLabel,
  }), [
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

  function handleMarkComplete() {
    setShowOutcomeModal(true);
  }

  async function submitOutcome(patch: LeadPatch) {
    setCompleting(true);
    try {
      const res = await patchLead(
        stop.id,
        patch,
        { updated_at: stop.updatedAt }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFlash(formatLeadPatchError(res, json, `Failed to mark complete (${res.status})`));
        if (res.status === 409) onReload();
        throw new Error("Save failed");
      }
      setShowOutcomeModal(false);
      onFlash(`Marked "${stop.label}" complete`);
      onReload();
    } catch (e) {
      onFlash((e as Error).message || "Failed to mark complete");
    } finally {
      setCompleting(false);
    }
  }

  const isDone = Boolean(stop.done);

  return (
    <li className={`py-3 first:pt-0 last:pb-0 ${isDone ? "bg-gray-50 -mx-4 px-4 opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex flex-col items-center gap-1 w-10 pt-0.5">
          <div
            className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold ${
              isDone
                ? "bg-gray-400 text-white"
                : "bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/30"
            }`}
            title={isDone ? "Completed" : "Flex — no time assigned yet"}
          >
            {isDone ? <Check className="h-4 w-4" /> : "F"}
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
            href={`/leads/${stop.id}`}
            className="block min-w-0 group"
          >
            <div className="flex items-center justify-between gap-2">
              <div className={`font-medium truncate group-hover:underline ${isDone ? "text-gray-400 line-through" : ""}`}>
                {stop.label}
              </div>
              {isDone && stop.outcomeLabel && (
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-gray-200 text-gray-600 px-2.5 py-0.5 text-[11px] font-semibold">
                  {stop.outcomeLabel}
                </span>
              )}
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
        {/* Expand/collapse chevron */}
        {!isDone && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse actions" : "Expand actions"}
            className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        )}
      </div>

      {/* Action pills — hidden by default, shown on tap */}
      {!isDone && expanded && (
        <div className="mt-2 pl-[52px] flex items-center gap-1.5 flex-wrap">
          <button
            onClick={handleMarkComplete}
            disabled={completing}
            aria-label={`Mark ${stop.label} complete`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/5 text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-60 px-3 h-8 text-xs font-medium"
          >
            {completing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Complete
          </button>
          {telHref && (
            <a
              href={telHref}
              aria-label={`Call ${stop.label}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)] px-3 h-8 text-xs font-medium"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
          )}
          {stop.phoneNumber && (
            <button
              type="button"
              onClick={() => setShowSmsPicker(true)}
              aria-label={`Text ${stop.label}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)] px-3 h-8 text-xs font-medium"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Text
            </button>
          )}
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`Navigate to ${stop.address}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface-2)] px-3 h-8 text-xs font-medium"
          >
            <Navigation className="h-3.5 w-3.5" />
            Nav
          </a>
        </div>
      )}
    {showOutcomeModal && (
      <EstimateOutcomeModal
        leadName={stop.label}
        onSubmit={submitOutcome}
        onCancel={() => setShowOutcomeModal(false)}
      />
    )}
    {showSmsPicker && stop.phoneNumber && (
      <SmsPickerModal
        phone={stop.phoneNumber}
        vars={smsVars}
        settings={settings}
        onClose={() => setShowSmsPicker(false)}
      />
    )}
    </li>
  );
}
