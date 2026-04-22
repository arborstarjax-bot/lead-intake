"use client";

import { useEffect, useRef, useState } from "react";
import {
  Phone,
  Mail,
  CalendarPlus,
  CalendarCheck,
  Trash2,
  Image as ImageIcon,
  MoreVertical,
  MapPin,
  StickyNote,
  User,
  Clock,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/components/SettingsProvider";
import { ContactRow } from "./ContactRow";
import { InlineField } from "./InlineField";
import { SalespersonPicker } from "./SalespersonPicker";
import { Section } from "./Section";
import { StatusPill } from "./StatusPill";
import { formatDateHuman } from "./lead-table-helpers";

export function LeadCard({
  lead,
  onPatch,
  onDelete,
  onAddCalendar,
  onToggleComplete,
  onAISchedule,
}: {
  lead: Lead;
  onPatch: (p: Partial<Lead>) => void;
  onDelete: () => void;
  onAddCalendar: () => void;
  onToggleComplete: () => void;
  onAISchedule: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { settings } = useAppSettings();

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
      {/* Header: status pill + actions menu */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <StatusPill
          status={lead.status}
          onChange={(next) => {
            if (next === "Completed" && lead.status !== "Completed") {
              onToggleComplete();
            } else {
              onPatch({ status: next });
            }
          }}
        />
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
        />
        <ContactRow
          icon={<Mail className="h-4 w-4" />}
          email
          lead={lead}
          field="email"
          onPatch={onPatch}
          settings={settings}
        />
      </Section>

      {/* Location */}
      <Section label="Location" icon={<MapPin className="h-4 w-4" />}>
        <InlineField
          value={lead.address ?? ""}
          placeholder="Street address"
          lead={lead}
          field="address"
          onPatch={onPatch}
          className="field-input"
        />
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
      </Section>

      {/* Appointment */}
      <Section label="Appointment" icon={<Clock className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-1">
          <InlineField
            value={lead.scheduled_day ?? ""}
            lead={lead}
            field="scheduled_day"
            onPatch={onPatch}
            type="date"
            className="field-input"
            placeholder="Day"
          />
          <InlineField
            value={lead.scheduled_time ?? ""}
            lead={lead}
            field="scheduled_time"
            onPatch={onPatch}
            type="time"
            className="field-input"
            placeholder="Time"
          />
        </div>
        <div className="mt-1 flex items-start gap-1 text-[var(--muted)]">
          <User className="h-4 w-4 ml-2 mt-3 shrink-0" />
          <SalespersonPicker
            value={lead.sales_person ?? ""}
            roster={settings.salespeople}
            onPatch={onPatch}
          />
        </div>
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
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
          {!scheduledInSync && (
            <button
              onClick={onAISchedule}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3 h-11 text-sm font-medium w-full sm:w-auto border border-[var(--accent)] text-[var(--accent)] bg-white hover:bg-[var(--accent-soft)] transition active:scale-[0.98]"
            >
              <Sparkles className="h-4 w-4" />
              {lead.scheduled_day ? "Find best time" : "Find best day & time"}
            </button>
          )}
        </div>
      </Section>

      {/* Notes */}
      <Section label="Notes" icon={<StickyNote className="h-4 w-4" />}>
        <InlineField
          value={lead.notes ?? ""}
          placeholder="Add notes…"
          lead={lead}
          field="notes"
          onPatch={onPatch}
          type="textarea"
          className="field-input resize-y min-h-[80px]"
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
    </article>
  );
}
