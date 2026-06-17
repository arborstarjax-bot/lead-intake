"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Phone,
  Mail,
  MessageSquare,
  CalendarCheck,
  Trash2,
  Image as ImageIcon,
  MoreVertical,
  MapPin,
  Route,
  User,
  AlertTriangle,
  CalendarDays,
  Bot,
  Navigation,
} from "lucide-react";
import {
  type Lead,
  type LeadPatch,
} from "@/modules/leads/model";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/SettingsProvider";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { AddressIntelligence } from "./AddressIntelligence";
import { InlineField } from "./InlineField";
import { LifecycleTimeline } from "./LifecycleTimeline";
import { SalespersonPicker } from "./SalespersonPicker";
import { StatusPill, type StatusTransition } from "./StatusPill";
import { FollowUpModal } from "./FollowUpModal";
import { OutcomeReasonModal } from "./OutcomeReasonModal";
import { LeadSourceBadge } from "./LeadSourceBadge";
import { LeadTypePill } from "./LeadTypePill";
import { OutcomeBadge } from "./OutcomeBadge";
import { AiCallButton } from "./AiCallButton";
import { AiCallHistory } from "./AiCallHistory";
import { formatDateHuman, formatScheduleDisplay, buildNavigationHref, templateVars } from "./lead-table-helpers";
import { logContactActivity } from "./LifecycleTimeline";
import { SmsPickerModal } from "./SmsPickerModal";
import { ArborBridgeButton } from "./ArborBridgeButton";

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
  const [showSmsPicker, setShowSmsPicker] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { settings } = useAppSettings();
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
  const phone = lead.phone_number?.trim() ?? "";
  const navHref = buildNavigationHref(lead);

  const logCall = () => {
    if (!phone) return;
    void logContactActivity(lead.id, "customer_called", {
      phone,
    }).then(() => setActivityRefreshKey((k) => k + 1));
  };

  const logText = (kind: "intro" | "confirm" | "enroute" | "blank") => {
    if (!phone) return;
    void logContactActivity(lead.id, "customer_texted", {
      phone,
      kind,
    }).then(() => setActivityRefreshKey((k) => k + 1));
  };

  return (
    <article
      className={cn(
        "relative rounded-2xl bg-[var(--surface)] border shadow-sm overflow-hidden",
        "transition-shadow hover:shadow-md",
        needsReview ? "border-amber-300" : "border-[var(--border)]"
      )}
    >
      {/* ── Header: status + source + type + menu ── */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
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
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)] active:bg-slate-100"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 z-30 w-52 rounded-xl border border-[var(--border)] bg-white shadow-lg overflow-hidden">
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
              <ArborBridgeButton lead={lead} onDone={() => setMenuOpen(false)} />
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

      {/* ── Client name + meta ── */}
      <div className="px-4 pt-1.5">
        <InlineField
          value={lead.client ?? ""}
          placeholder="Client name"
          lead={lead}
          field="client"
          onPatch={onPatch}
          className="field-input !py-1 !px-2 !min-h-[36px] text-[22px] font-bold tracking-tight"
        />
        <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)] px-0.5">
          <span>{dateLabel}</span>
          {lead.intake_source !== "web_upload" && (
            <>
              <span className="text-[var(--subtle)]">·</span>
              <span className="capitalize">{lead.intake_source.replace("_", " ")}</span>
            </>
          )}
          {lead.lead_type && (
            <>
              <span className="text-[var(--subtle)]">·</span>
              <span>{lead.lead_type}</span>
            </>
          )}
          {needsReview && (
            <>
              <span className="text-[var(--subtle)]">·</span>
              <span className="inline-flex items-center gap-1 text-[var(--warning)]">
                <AlertTriangle className="h-3 w-3" />
                review
              </span>
            </>
          )}
        </div>
        {lead.outcome_badge && (
          <div className="mt-1.5">
            <OutcomeBadge badge={lead.outcome_badge} />
          </div>
        )}
      </div>

      {/* ── Quick action buttons ── */}
      <div className="flex gap-1.5 px-4 pt-3">
        {/* Call */}
        <a
          href={phone ? `tel:${phone}` : undefined}
          aria-disabled={!phone}
          onClick={() => { if (phone) logCall(); }}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl text-[13px] font-semibold transition active:scale-[0.97]",
            phone
              ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200"
              : "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed"
          )}
        >
          <Phone className="h-4 w-4" />
          Call
        </a>
        {/* Text */}
        <button
          type="button"
          onClick={() => { if (phone) setShowSmsPicker(true); }}
          disabled={!phone}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl text-[13px] font-semibold transition active:scale-[0.97]",
            phone
              ? "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
              : "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed"
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Text
        </button>
        {/* AI Call */}
        {phone ? (
          <div className="flex-[1.3]">
            <AiCallButton
              leadId={lead.id}
              callInfo={{
                ai_call_count: lead.ai_call_count,
                ai_last_call_at: lead.ai_last_call_at,
                ai_last_call_status: lead.ai_last_call_status,
                ai_notes: lead.ai_notes,
              }}
              onCallTriggered={() => setActivityRefreshKey((k) => k + 1)}
              compact
            />
          </div>
        ) : (
          <span className="flex-[1.3] inline-flex items-center justify-center gap-1.5 h-11 rounded-xl text-[13px] font-semibold bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed">
            <Bot className="h-4 w-4" />
            AI Call
          </span>
        )}
      </div>

      {/* ── Contact info rows ── */}
      <div className="flex flex-col gap-1.5 px-4 pt-3 pb-1">
        {/* Phone */}
        <div className="flex items-center gap-2.5">
          <Phone className="h-4 w-4 text-[var(--muted)] shrink-0" />
          <InlineField
            value={lead.phone_number ?? ""}
            placeholder="Phone number"
            lead={lead}
            field="phone_number"
            onPatch={onPatch}
            type="tel"
            inputMode="tel"
            className="field-input flex-1 !py-1 !min-h-[32px] text-sm"
            formatAs="phone"
          />
          {navHref && (
            <a
              href={navHref}
              title="Navigate to address"
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-[var(--brand-bright)] text-[var(--brand-bright)] hover:bg-[#ecfccb] shrink-0"
            >
              <Navigation className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        {/* Email */}
        <div className="flex items-center gap-2.5">
          <Mail className="h-4 w-4 text-[var(--muted)] shrink-0" />
          <InlineField
            value={lead.email ?? ""}
            placeholder="Email address"
            lead={lead}
            field="email"
            onPatch={onPatch}
            type="email"
            inputMode="email"
            className="field-input flex-1 !py-1 !min-h-[32px] text-sm"
          />
        </div>
        {/* Address */}
        <div className="flex items-start gap-2.5">
          <MapPin className="h-4 w-4 text-[var(--muted)] shrink-0 mt-2" />
          <div className="flex-1 min-w-0">
            <AddressAutocomplete lead={lead} onPatch={onPatch} />
            <div className="grid grid-cols-[1fr_56px_80px] gap-1 mt-0.5">
              <InlineField
                value={lead.city ?? ""}
                placeholder="City"
                lead={lead}
                field="city"
                onPatch={onPatch}
                className="field-input !py-0.5 !min-h-[28px] text-xs text-[var(--muted)]"
              />
              <InlineField
                value={lead.state ?? ""}
                placeholder="ST"
                lead={lead}
                field="state"
                onPatch={onPatch}
                className="field-input !py-0.5 !min-h-[28px] text-xs text-[var(--muted)] uppercase"
              />
              <InlineField
                value={lead.zip ?? ""}
                placeholder="Zip"
                lead={lead}
                field="zip"
                onPatch={onPatch}
                className="field-input !py-0.5 !min-h-[28px] text-xs text-[var(--muted)]"
                inputMode="numeric"
              />
            </div>
            <AddressIntelligence lead={lead} onPatch={onPatch} />
          </div>
        </div>
      </div>

      {/* ── Schedule strip / CTA ── */}
      <div className="px-4 pt-1 pb-1">
        {lead.scheduled_day || lead.scheduled_time || lead.flex_window ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--success-soft)] border border-green-200 px-3 py-2.5">
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
                Edit
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
        ) : (
          <button
            onClick={onAISchedule}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-[var(--accent)] text-white text-[15px] font-semibold hover:bg-[var(--accent-hover)] transition active:scale-[0.98]"
          >
            <CalendarDays className="h-[18px] w-[18px]" />
            Schedule Estimate
          </button>
        )}

        {/* Route + Calendar actions for scheduled leads */}
        {(lead.scheduled_day || lead.scheduled_time || lead.flex_window) && (
          <div className="mt-2 flex gap-2">
            {(() => {
              const isScheduled = lead.status === "Scheduled";
              const disabled = !lead.scheduled_day;
              return (
                <Link
                  href={lead.scheduled_day ? `/route?day=${lead.scheduled_day}` : "#"}
                  onClick={(e) => {
                    if (disabled) { e.preventDefault(); return; }
                    if (!isScheduled) onPatch({ status: "Scheduled" });
                  }}
                  aria-disabled={disabled}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-lg px-3 h-10 text-sm font-medium flex-1 transition active:scale-[0.98]",
                    disabled
                      ? "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed pointer-events-none"
                      : "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-soft-hover,var(--accent-soft))] border border-[var(--accent)]/30"
                  )}
                >
                  <Route className="h-4 w-4" />
                  {isScheduled ? "View Route" : "Add to Route"}
                </Link>
              );
            })()}
            {scheduledInSync ? (
              <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--success-soft)] text-[var(--success)] px-3 h-10 text-sm font-medium flex-1 justify-center">
                <CalendarCheck className="h-4 w-4" />
                On Calendar
              </span>
            ) : (
              <button
                onClick={onAddCalendar}
                disabled={!lead.scheduled_day}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-lg px-3 h-10 text-sm font-medium flex-1 transition active:scale-[0.98]",
                  needsResync
                    ? "bg-[var(--warning-soft)] text-[var(--warning)] hover:bg-amber-200"
                    : lead.scheduled_day
                    ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                    : "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed"
                )}
              >
                <CalendarDays className="h-4 w-4" />
                {needsResync ? "Sync Calendar" : "Add to Calendar"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      <div className="px-4 pt-2 pb-1">
        <InlineField
          value={lead.notes ?? ""}
          placeholder="Notes…"
          lead={lead}
          field="notes"
          onPatch={onPatch}
          type="textarea"
          className="field-input min-h-[72px] leading-5 text-sm bg-[var(--surface-2)] rounded-xl !border-transparent"
        />
        {phone && (
          <AiCallHistory
            leadId={lead.id}
            refreshKey={activityRefreshKey}
          />
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <User className="h-3.5 w-3.5 text-[var(--muted)] shrink-0" />
          <SalespersonPicker
            value={lead.sales_person ?? ""}
            roster={settings.salespeople}
            onPatch={onPatch}
          />
        </div>
        <LifecycleTimeline
          leadId={lead.id}
          refreshKey={activityRefreshKey + statusFingerprint(lead.status)}
        />
      </div>

      {/* ── Modals ── */}
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

      {showSmsPicker && phone && (
        <SmsPickerModal
          phone={phone}
          vars={templateVars(lead, settings)}
          settings={settings}
          onClose={() => setShowSmsPicker(false)}
          onSelect={logText}
        />
      )}
    </article>
  );
}

function statusFingerprint(status: string): number {
  let h = 0;
  for (let i = 0; i < status.length; i++) {
    h = (h * 31 + status.charCodeAt(i)) >>> 0;
  }
  return h * 1000;
}
