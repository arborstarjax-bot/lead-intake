"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone,
  Mail,
  MessageSquare,
  CalendarPlus,
  CalendarCheck,
  Trash2,
  Image as ImageIcon,
  Undo2,
  Plus,
  Search,
  MoreVertical,
  MapPin,
  StickyNote,
  User,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import type { Lead, LeadStatus } from "@/lib/types";
import { LEAD_STATUSES, EDITABLE_COLUMNS } from "@/lib/types";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import ScheduleModal from "@/components/ScheduleModal";

type FieldDef = {
  key: keyof Lead;
  label: string;
  type?: "text" | "date" | "time" | "textarea" | "tel" | "email";
  placeholder?: string;
  inputMode?: "text" | "tel" | "email" | "numeric";
};

export type LeadFilter = "All" | LeadStatus;
export type LeadCounts = Record<LeadFilter, number>;

export default function LeadTable({
  filter,
  onCounts,
  onScheduleChange,
}: {
  filter: LeadFilter;
  onCounts?: (n: LeadCounts) => void;
  /** Fires when a lead gains/loses a scheduled_time so parents can refresh
   *  derived views (e.g. today's route). */
  onScheduleChange?: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ leadId: string; prev: LeadStatus } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [schedulingLead, setSchedulingLead] = useState<Lead | null>(null);

  function showFlash(message: string) {
    setFlash(message);
    setTimeout(() => setFlash((f) => (f === message ? null : f)), 3_000);
  }

  /**
   * Fetch and update the list. Only shows the skeleton on the very first
   * load; background polls happen silently so users don't see a flash every
   * time the 15s poller fires.
   */
  async function refresh({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/leads?view=all`).then((r) => r.json());
      const all: Lead[] = r.leads ?? [];
      setLeads(all);
      const counts: LeadCounts = {
        All: all.length,
        New: 0,
        "Called / No Response": 0,
        Scheduled: 0,
        Completed: 0,
        Lost: 0,
      };
      for (const l of all) counts[l.status] = (counts[l.status] ?? 0) + 1;
      onCounts?.(counts);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(() => refresh({ silent: true }), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const byStatus = filter === "All" ? leads : leads.filter((l) => l.status === filter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((l) =>
      EDITABLE_COLUMNS.some((k) => {
        const v = l[k];
        return typeof v === "string" && v.toLowerCase().includes(q);
      })
    );
  }, [leads, search, filter]);

  async function savePatch(id: string, patch: Partial<Lead>) {
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (res.ok && json.lead) {
      // Update the lead in-place; the `filtered` memo re-tabs it automatically
      // if its status changed. No need to re-fetch the whole list.
      setLeads((prev) => {
        const updated: Lead = json.lead;
        const counts: LeadCounts = {
          All: 0,
          New: 0,
          "Called / No Response": 0,
          Scheduled: 0,
          Completed: 0,
          Lost: 0,
        };
        const next = prev.map((l) => (l.id === id ? updated : l));
        counts.All = next.length;
        for (const l of next) counts[l.status] = (counts[l.status] ?? 0) + 1;
        onCounts?.(counts);
        return next;
      });
    } else {
      alert(json.error ?? "Save failed");
    }
  }

  async function onMarkCompleted(lead: Lead) {
    const prev = lead.status;
    setToast({ leadId: lead.id, prev });
    await savePatch(lead.id, { status: "Completed" });
    setTimeout(() => setToast((t) => (t?.leadId === lead.id ? null : t)), 6_000);
  }

  async function onUndoComplete(leadId: string, prev: LeadStatus) {
    await savePatch(leadId, { status: prev === "Completed" ? "New" : prev });
    setToast(null);
  }

  async function onDelete(id: string) {
    if (
      !confirm(
        "Delete this lead permanently? Use Completed instead if you want to keep history."
      )
    )
      return;
    await fetch(`/api/leads/${id}`, { method: "DELETE" });
    refresh({ silent: true });
  }

  async function onAddRow() {
    const res = await fetch("/api/leads", { method: "POST" });
    if (res.ok) refresh({ silent: true });
  }

  async function onAddCalendar(lead: Lead) {
    if (!lead.scheduled_day) {
      alert("Scheduled Day is required before adding to calendar.");
      return;
    }
    const res = await fetch(`/api/leads/${lead.id}/calendar`, { method: "POST" });
    const json = await res.json();
    if (res.status === 428) {
      if (confirm("Google Calendar is not connected. Connect now?")) {
        window.location.href = json.connectUrl;
      }
      return;
    }
    if (!res.ok) {
      alert(json.error ?? "Calendar failed");
      return;
    }
    if (json.htmlLink) window.open(json.htmlLink, "_blank");
    showFlash("Estimate Added to Calendar");
    refresh({ silent: true });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--subtle)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 py-2.5 text-[15px] shadow-sm focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(5,150,105,0.15)]"
          />
        </div>
        <button
          onClick={onAddRow}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-medium shadow-sm hover:bg-[var(--surface-2)] active:scale-[0.98] transition"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Lead</span>
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-64 rounded-2xl bg-[var(--surface)] border border-[var(--border)] animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center text-[var(--muted)]">
          {filter === "All"
            ? "No leads yet. Upload a screenshot on the home page."
            : filter === "Completed"
            ? "No completed leads yet."
            : `No leads in "${filter}" yet.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onPatch={(p) => savePatch(lead.id, p)}
              onDelete={() => onDelete(lead.id)}
              onAddCalendar={() => onAddCalendar(lead)}
              onToggleComplete={() => onMarkCompleted(lead)}
              onAISchedule={() => setSchedulingLead(lead)}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center pointer-events-none px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-[var(--fg)] text-white px-4 py-2.5 shadow-lg text-sm">
            <CheckCircle2 className="h-4 w-4 text-[var(--accent-soft)]" />
            Marked Completed.
            <button
              onClick={() => onUndoComplete(toast.leadId, toast.prev)}
              className="inline-flex items-center gap-1 underline"
            >
              <Undo2 className="h-4 w-4" /> Undo
            </button>
          </div>
        </div>
      )}

      {flash && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center pointer-events-none px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--accent)] text-white px-4 py-2.5 shadow-lg text-sm">
            <CalendarCheck className="h-4 w-4" />
            {flash}
          </div>
        </div>
      )}

      {schedulingLead && (
        <ScheduleModal
          lead={schedulingLead}
          onClose={() => setSchedulingLead(null)}
          onBooked={(updated, htmlLink) => {
            setLeads((prev) => {
              const counts: LeadCounts = {
                All: 0,
                New: 0,
                "Called / No Response": 0,
                Scheduled: 0,
                Completed: 0,
                Lost: 0,
              };
              const next = prev.map((l) => (l.id === updated.id ? updated : l));
              counts.All = next.length;
              for (const l of next) counts[l.status] = (counts[l.status] ?? 0) + 1;
              onCounts?.(counts);
              return next;
            });
            onScheduleChange?.();
            showFlash("Estimate Added to Calendar");
            // Intentionally do NOT auto-open the calendar tab — the modal
            // stays on its success step so the user can send an SMS
            // confirmation. htmlLink is passed through and rendered as a
            // link there.
            void htmlLink;
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Lead card ---------------- */

function LeadCard({
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
        />
        <ContactRow
          icon={<Mail className="h-4 w-4" />}
          email
          lead={lead}
          field="email"
          onPatch={onPatch}
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
        <div className="mt-1 flex items-center gap-1 text-[var(--muted)]">
          <User className="h-4 w-4 ml-2" />
          <InlineField
            value={lead.sales_person ?? ""}
            placeholder="Salesperson"
            lead={lead}
            field="sales_person"
            onPatch={onPatch}
            className="field-input"
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

/* ---------------- Sub-components ---------------- */

function Section({
  label,
  icon,
  children,
}: {
  label?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 pt-3 pb-1">
      {label && (
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          {icon}
          <span>{label}</span>
        </div>
      )}
      {children}
    </section>
  );
}

function StatusPill({
  status,
  onChange,
}: {
  status: LeadStatus;
  onChange: (next: LeadStatus) => void;
}) {
  const style = STATUS_STYLE[status];
  return (
    <div
      className={cn(
        "relative inline-flex items-center rounded-full px-3 h-9 text-sm font-medium",
        style.bg,
        style.fg
      )}
    >
      <span className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: style.dot }} />
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as LeadStatus)}
        className={cn(
          "appearance-none bg-transparent pr-6 focus:outline-none",
          style.fg
        )}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs",
          style.fg
        )}
      >
        ▾
      </span>
    </div>
  );
}

const STATUS_STYLE: Record<LeadStatus, { bg: string; fg: string; dot: string }> = {
  New: { bg: "bg-[var(--status-new-bg)]", fg: "text-[var(--status-new-fg)]", dot: "#2563eb" },
  "Called / No Response": {
    bg: "bg-[var(--status-called-bg)]",
    fg: "text-[var(--status-called-fg)]",
    dot: "#d97706",
  },
  Scheduled: {
    bg: "bg-[var(--status-scheduled-bg)]",
    fg: "text-[var(--status-scheduled-fg)]",
    dot: "#4f46e5",
  },
  Completed: {
    bg: "bg-[var(--status-completed-bg)]",
    fg: "text-[var(--status-completed-fg)]",
    dot: "#059669",
  },
  Lost: {
    bg: "bg-slate-100",
    fg: "text-slate-600",
    dot: "#64748b",
  },
};

function ContactRow({
  icon,
  tel,
  email,
  lead,
  field,
  onPatch,
}: {
  icon: React.ReactNode;
  tel?: boolean;
  email?: boolean;
  lead: Lead;
  field: "phone_number" | "email";
  onPatch: (p: Partial<Lead>) => void;
}) {
  const raw = (lead[field] ?? "") as string;
  const trimmed = raw.trim();
  const primaryHref =
    tel && trimmed ? `tel:${trimmed}` : email && trimmed ? `mailto:${trimmed}` : undefined;
  const smsHref = tel && trimmed ? buildSmsHref(trimmed, lead) : undefined;

  return (
    <div className="flex items-stretch gap-1">
      <ActionIconLink href={primaryHref} title={tel ? "Call" : "Email"}>
        {icon}
      </ActionIconLink>
      {tel && (
        <ActionIconLink href={smsHref} title="Send text message">
          <MessageSquare className="h-4 w-4" />
        </ActionIconLink>
      )}
      <InlineField
        value={raw}
        placeholder={tel ? "Phone number" : "Email address"}
        lead={lead}
        field={field}
        onPatch={onPatch}
        type={tel ? "tel" : "email"}
        inputMode={tel ? "tel" : "email"}
        className="field-input flex-1"
        formatAs={tel ? "phone" : undefined}
      />
    </div>
  );
}

/**
 * Build the tel/sms link for a lead. The body is David's standard
 * first-touch intro; the greeting uses the lead's first name when known
 * and falls back to "there" so the sentence still reads naturally.
 *
 * iOS and Android both honor `sms:<number>?body=<urlencoded>`.
 */
function buildSmsHref(phone: string, lead: Lead): string {
  const firstName = (lead.first_name ?? "").trim() || (lead.client ?? "").trim().split(" ")[0] || "there";
  const body =
    `Hi ${firstName}, this is David with Arbor Tech 904. I'm reaching ` +
    `out regarding your request for a free estimate/arborist assessment. ` +
    `Feel free to call or text me to schedule a day and time that works ` +
    `best for you. I look forward to helping you out!`;
  return `sms:${phone}?body=${encodeURIComponent(body)}`;
}

function ActionIconLink({
  href,
  title,
  children,
}: {
  href: string | undefined;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-disabled={!href}
      aria-label={title}
      title={title}
      onClick={(e) => {
        if (!href) e.preventDefault();
      }}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition",
        href
          ? "border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          : "border-[var(--border)] text-[var(--subtle)] opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </a>
  );
}

/* ---------------- Inline editable field ---------------- */

function InlineField({
  value,
  placeholder,
  lead,
  field,
  onPatch,
  type,
  inputMode,
  className,
  formatAs,
}: {
  value: string;
  placeholder?: string;
  lead: Lead;
  field: keyof Lead;
  onPatch: (p: Partial<Lead>) => void;
  type?: FieldDef["type"];
  inputMode?: FieldDef["inputMode"];
  className?: string;
  formatAs?: "phone";
}) {
  const [local, setLocal] = useState<string>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  function scheduleSave(next: string) {
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const patch: Partial<Lead> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[field] = next === "" ? null : next;
      onPatch(patch);
    }, 500);
  }

  const conf = lead.extraction_confidence?.[field as string];
  const lowConf =
    typeof conf === "number" && conf > 0 && conf < 0.6 && Boolean(local);
  const display = formatAs === "phone" && local ? formatPhone(local) : local;

  if (type === "textarea") {
    return (
      <textarea
        value={display}
        placeholder={placeholder}
        onChange={(e) => scheduleSave(e.target.value)}
        rows={3}
        className={cn(className, lowConf && "invalid-soft")}
      />
    );
  }

  return (
    <input
      type={type ?? "text"}
      value={display}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => scheduleSave(e.target.value)}
      className={cn(className, lowConf && "invalid-soft")}
      title={lowConf ? `Low confidence (${Math.round((conf ?? 0) * 100)}%)` : undefined}
    />
  );
}

function formatDateHuman(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
