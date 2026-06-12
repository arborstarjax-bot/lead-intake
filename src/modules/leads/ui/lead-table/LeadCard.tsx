"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Phone,
  Mail,
  CalendarPlus,
  CalendarCheck,
  Trash2,
  Image as ImageIcon,
  MoreVertical,
  MapPin,
  Route,
  StickyNote,
  User,
  Clock,
  AlertTriangle,
  CalendarDays,
} from "lucide-react";
import {
  type Lead,
  type LeadPatch,
} from "@/modules/leads/model";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/SettingsProvider";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { AddressIntelligence } from "./AddressIntelligence";
import { ContactRow } from "./ContactRow";
import { InlineField } from "./InlineField";
import { LifecycleTimeline } from "./LifecycleTimeline";
import { SalespersonPicker } from "./SalespersonPicker";
import { Section } from "./Section";
import { StatusPill, type StatusTransition } from "./StatusPill";
import { FollowUpModal } from "./FollowUpModal";
import { OutcomeReasonModal } from "./OutcomeReasonModal";
import { LeadSourceBadge } from "./LeadSourceBadge";
import { LeadTypePill } from "./LeadTypePill";
import { OutcomeBadge } from "./OutcomeBadge";
import { AiCallButton } from "./AiCallButton";
import { formatDateHuman, formatScheduleDisplay } from "./lead-table-helpers";

export function LeadCard({
  lead,
  onPatch,
  onDelete,
  onAddCalendar,
  onToggleComplete,
  onAISchedule,
}: {
  lead: Lead;
  onPatch: (p: LeadPatch) => void;
  onDelete: () => void;
  onAddCalendar: () => void;
  onToggleComplete: () => void;
  onAISchedule: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [lostModalOpen, setLostModalOpen] = useState(false);
  const [notSoldModalOpen, setNotSoldModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { settings } = useAppSettings();
  // Bumped after a call/text is logged so the timeline (if expanded)
  // refetches and shows the new row. LifecycleTimeline itself also
  // refetches on `lead.status` change via its internal deps; this handles
  // the purely-contact-action case where status doesn't move.
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const needsReview =
    lead.intake_status === "needs_review" || lead.intake_status === "failed";

  const scheduledInSync =
    Boolean(lead.calendar_event_id) &&
    lead.calendar_scheduled_day === lead.scheduled_day &&
    (lead.calendar_scheduled_time ?? null) === (lead.scheduled_time ?? null);
  const needsResync = Boolean(lead.calendar_event_id) && !scheduledInSync;

  const dateLabel = formatDateHuman(lead.date ?? lead.created_at);

  return (
    <article
      className={cn(
        "relative rounded-2xl bg-[var(--surface)] border shadow-sm overflow-hidden",
        "transition-shadow hover:shadow-md",
        needsReview ? "border-amber-300" : "border-[var(--border)]"
      )}
    >
      {/* Header: status pill + lead source + actions menu */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <StatusPill
            status={lead.status}
            outcomeBadge={lead.outcome_badge}
            followUpResult={lead.follow_up_result}
            onChange={(t: StatusTransition) => {
              switch (t.kind) {
                case "sold":
                  onPatch({ status: "Completed", estimate_outcome: "Sold", outcome_badge: "Sold" });
                  break;
                case "not_sold":
                  setNotSoldModalOpen(true);
                  break;
                case "lost":
                  setLostModalOpen(true);
                  break;
                case "needs_follow_up":
                  setFollowUpModalOpen(true);
                  break;
                case "completed":
                  onToggleComplete();
                  break;
                case "simple":
                  if (t.status === "Completed" && lead.status !== "Completed") {
                    onToggleComplete();
                  } else {
                    onPatch({ status: t.status });
                  }
                  break;
              }
            }}
          />
          <LeadSourceBadge lead={lead} onPatch={onPatch} />
          <LeadTypePill lead={lead} onPatch={onPatch} />
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More actions"
            className="inline-flex items-center justify-center h-11 w-11 -mr-2 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)] active:bg-slate-100"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 z-30 w-52 rounded-xl border border-[var(--border)] bg-white shadow-lg overflow-hidden">
              {lead.screenshot_path && (
                <a
                  href={`/api/leads/${lead.id}/screenshot`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-3 text-sm hover:bg-[var(--surface-2)]"
                >
                  <ImageIcon className="h-4 w-4 text-[var(--muted)]" />
                  View original screenshot
                </a>
              )}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-3 text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              >
                <Trash2 className="h-4 w-4" />
                Delete lead
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Headline: client name */}
      <div className="px-4 pt-2">
        <InlineField
          value={lead.client ?? ""}
          placeholder="Client name"
          lead={lead}
          field="client"
          onPatch={onPatch}
          className="field-input !py-1.5 !px-2 !min-h-[40px] text-xl sm:text-2xl font-semibold tracking-tight"
        />
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
          <span>Uploaded {dateLabel}</span>
          {lead.intake_source !== "web_upload" && (
            <>
              <span className="text-[var(--subtle)]">·</span>
              <span className="capitalize">{lead.intake_source.replace("_", " ")}</span>
            </>
          )}
          {needsReview && (
            <>
              <span className="text-[var(--subtle)]">·</span>
              <span className="inline-flex items-center gap-1 text-[var(--warning)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                needs review
              </span>
            </>
          )}
        </div>
        {lead.outcome_badge && (
          <div className="mt-2">
            <OutcomeBadge badge={lead.outcome_badge} />
          </div>
        )}
      </div>

      {/* Contact: phone + email */}
      <Section>
        <ContactRow
          icon={<Phone className="h-4 w-4" />}
          tel
          lead={lead}
          field="phone_number"
          onPatch={onPatch}
          settings={settings}
          onActivityLogged={() => setActivityRefreshKey((k) => k + 1)}
        />
        <ContactRow
          icon={<Mail className="h-4 w-4" />}
          email
          lead={lead}
          field="email"
          onPatch={onPatch}
          settings={settings}
        />
        {lead.phone_number && (
          <div className="mt-2">
            <AiCallButton leadId={lead.id} />
          </div>
        )}
      </Section>

      {/* Location */}
      <Section label="Location" icon={<MapPin className="h-4 w-4" />}>
        <AddressAutocomplete lead={lead} onPatch={onPatch} />
        <div className="grid grid-cols-[1fr_72px_100px] gap-1 mt-1">
          <InlineField
            value={lead.city ?? ""}
            placeholder="City"
            lead={lead}
            field="city"
            onPatch={onPatch}
            className="field-input"
          />
          <InlineField
            value={lead.state ?? ""}
            placeholder="ST"
            lead={lead}
            field="state"
            onPatch={onPatch}
            className="field-input uppercase"
          />
          <InlineField
            value={lead.zip ?? ""}
            placeholder="Zip"
            lead={lead}
            field="zip"
            onPatch={onPatch}
            className="field-input"
            inputMode="numeric"
          />
        </div>
        {/* Address intelligence: one-tap autofill for missing fields
            plus a row of "AI ##%" confidence chips for any fields we
            (or the ingest pipeline) inferred. Lives inside the Location
            section so the operator's eye flows straight from the inputs
            to the reliability signal. */}
        <AddressIntelligence lead={lead} onPatch={onPatch} />
      </Section>

      {/* Appointment — simplified scheduling flow */}
      <Section label="Appointment" icon={<Clock className="h-4 w-4" />}>
        {lead.scheduled_day || lead.scheduled_time || lead.flex_window ? (
          <>
            {/* Compact scheduled confirmation strip */}
            <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--success-soft)] border border-green-200 px-3.5 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-200/60 text-[var(--success)] shrink-0">
                  <CalendarCheck className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--success)] truncate">
                    {formatScheduleDisplay(lead.scheduled_day, lead.scheduled_time, lead.flex_window)}
                  </div>
                  <div className="text-[11px] text-green-700/70 mt-0.5">
                    {scheduledInSync ? "Synced to calendar" : needsResync ? "Calendar out of sync" : "Not yet on calendar"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onAISchedule}
                  className="text-xs font-semibold text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)] transition"
                >
                  Reschedule
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onPatch({
                      scheduled_day: null,
                      scheduled_time: null,
                      flex_window: null,
                    })
                  }
                  className="text-[var(--muted)] hover:text-[var(--danger)] transition"
                  title="Clear schedule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {/* Calendar + Route actions when scheduled */}
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              {(() => {
                const isScheduled = lead.status === "Scheduled";
                const disabled = !lead.scheduled_day;
                return (
                  <Link
                    href={lead.scheduled_day ? `/route?day=${lead.scheduled_day}` : "#"}
                    onClick={(e) => {
                      if (disabled) {
                        e.preventDefault();
                        return;
                      }
                      if (!isScheduled) onPatch({ status: "Scheduled" });
                    }}
                    aria-disabled={disabled}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-lg px-3 h-11 text-sm font-medium w-full sm:w-auto transition active:scale-[0.98]",
                      disabled
                        ? "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed pointer-events-none"
                        : "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-soft-hover,var(--accent-soft))] border border-[var(--accent)]/30"
                    )}
                  >
                    <Route className="h-4 w-4" />
                    {isScheduled ? "Update in Route" : "Add to Route"}
                  </Link>
                );
              })()}
              {scheduledInSync ? (
                <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--success-soft)] text-[var(--success)] px-3 h-11 text-sm font-medium w-full justify-center sm:w-auto">
                  <CalendarCheck className="h-4 w-4" />
                  Lead Scheduled
                </span>
              ) : (
                <button
                  onClick={onAddCalendar}
                  disabled={!lead.scheduled_day}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-lg px-3 h-11 text-sm font-medium w-full sm:w-auto transition active:scale-[0.98]",
                    needsResync
                      ? "bg-[var(--warning-soft)] text-[var(--warning)] hover:bg-amber-200"
                      : lead.scheduled_day
                      ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                      : "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed"
                  )}
                >
                  <CalendarPlus className="h-4 w-4" />
                  {needsResync ? "Update calendar event" : "Add to Calendar"}
                </button>
              )}
            </div>
          </>
        ) : (
          /* Single Schedule button for unscheduled leads */
          <button
            onClick={onAISchedule}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-[var(--accent)] text-white text-[15px] font-semibold hover:bg-[var(--accent-hover)] transition active:scale-[0.98]"
          >
            <CalendarDays className="h-[18px] w-[18px]" />
            Schedule
          </button>
        )}
        <div className="mt-2 flex items-start gap-1 text-[var(--muted)]">
          <User className="h-4 w-4 ml-2 mt-3 shrink-0" />
          <SalespersonPicker
            value={lead.sales_person ?? ""}
            roster={settings.salespeople}
            onPatch={onPatch}
          />
        </div>
      </Section>

      {/* Notes — editable. Free-form place for the rep to capture estimate,
          property, customer, or follow-up context. Autosaves on blur /
          after 500 ms of keyboard quiet (see InlineField). Previously
          this was read-only because the debounced autosave used to
          clobber in-flight keystrokes; that's fixed in InlineField's
          focus-aware effect, so the textarea can accept edits again. */}
      <Section label="Notes" icon={<StickyNote className="h-4 w-4" />}>
        <InlineField
          value={lead.notes ?? ""}
          placeholder="Details about the lead, estimate, customer, property, or follow-ups…"
          lead={lead}
          field="notes"
          onPatch={onPatch}
          type="textarea"
          className="field-input min-h-[88px] leading-5"
        />
        {/* Lifecycle timeline — collapsed by default. Lazy-loads on first
            open and re-fetches whenever a call/text is logged (via the
            activity refresh key) or the lead's status changes. */}
        <LifecycleTimeline
          leadId={lead.id}
          refreshKey={activityRefreshKey + statusFingerprint(lead.status)}
        />
      </Section>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <label className="inline-flex items-center gap-2.5 text-sm text-[var(--fg)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lead.status === "Completed"}
            onChange={() => {
              if (lead.status === "Completed") {
                onPatch({ status: "New" });
              } else {
                onToggleComplete();
              }
            }}
            className="h-5 w-5 cursor-pointer accent-[var(--accent)]"
          />
          Mark as completed
        </label>
      </div>

      {followUpModalOpen && (
        <FollowUpModal
          leadName={lead.client?.trim() || "Lead"}
          onSubmit={async (patch) => {
            onPatch(patch);
            setFollowUpModalOpen(false);
          }}
          onCancel={() => setFollowUpModalOpen(false)}
        />
      )}

      {lostModalOpen && (
        <OutcomeReasonModal
          leadName={lead.client?.trim() || "Lead"}
          outcomeLabel="Lost"
          onSubmit={async (patch) => {
            onPatch(patch);
            setLostModalOpen(false);
          }}
          onCancel={() => setLostModalOpen(false)}
        />
      )}

      {notSoldModalOpen && (
        <OutcomeReasonModal
          leadName={lead.client?.trim() || "Lead"}
          outcomeLabel="Not Sold"
          onSubmit={async (patch) => {
            onPatch(patch);
            setNotSoldModalOpen(false);
          }}
          onCancel={() => setNotSoldModalOpen(false)}
        />
      )}
    </article>
  );
}

/** Tiny hash so a status change bumps the timeline's refresh key. Any
 *  stable mapping from the status string to a number works — we just need
 *  LifecycleTimeline's effect to re-fire when status moves. */
function statusFingerprint(status: string): number {
  let h = 0;
  for (let i = 0; i < status.length; i++) {
    h = (h * 31 + status.charCodeAt(i)) >>> 0;
  }
  // Multiply by 1000 so it doesn't collide with the activity refresh key's
  // small integer space.
  return h * 1000;
}


