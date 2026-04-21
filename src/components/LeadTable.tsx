"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Phone,
  Mail,
  MessageSquare,
  CalendarPlus,
  CalendarCheck,
  Trash2,
  Image as ImageIcon,
  Plus,
  Search,
  MoreVertical,
  MapPin,
  StickyNote,
  User,
  Clock,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import type { Lead, LeadStatus } from "@/lib/types";
import { LEAD_STATUSES, EDITABLE_COLUMNS } from "@/lib/types";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { useAppSettings } from "@/components/SettingsProvider";
import {
  renderTemplate,
  smsIntroTemplate,
  emailSubjectTemplate,
  emailBodyTemplate,
  type TemplateVars,
} from "@/lib/templates";
import type { ClientAppSettings } from "@/lib/client-settings";

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
  const router = useRouter();
  const { toast } = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Leads the user just deleted. Held for the undo window so we can re-insert
  // them in place if they tap Undo before the background DELETE fires.
  const pendingDeletes = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  /**
   * Fetch and update the list. Only shows the skeleton on the very first
   * load; background polls happen silently so users don't see a flash every
   * time the 15s poller fires.
   */
  async function refresh({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/leads?view=all`).then((r) => r.json());
      // Hide any leads the user just optimistically deleted; the server
      // won't drop them until the 5s undo timer fires, and we don't want a
      // mid-window background poll to resurrect them.
      const all: Lead[] = (r.leads ?? []).filter(
        (l: Lead) => !pendingDeletes.current.has(l.id)
      );
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

  async function savePatch(id: string, patch: Partial<Lead>): Promise<boolean> {
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
      // Any edit that touches the day or time of a lead may rearrange the
      // "Today's Route" card on /leads — notify the parent so it can re-poll.
      if ("scheduled_time" in patch || "scheduled_day" in patch) {
        onScheduleChange?.();
      }
      return true;
    }
    toast({ kind: "error", message: json.error ?? "Save failed" });
    return false;
  }

  async function onMarkCompleted(lead: Lead) {
    const prev = lead.status;
    const ok = await savePatch(lead.id, { status: "Completed" });
    // savePatch surfaces its own error toast on failure; don't stack a
    // contradictory "Marked Completed" success on top of it.
    if (!ok) return;
    toast({
      kind: "success",
      message: "Marked Completed",
      action: {
        label: "Undo",
        onClick: () => {
          savePatch(lead.id, {
            status: prev === "Completed" ? "New" : prev,
          });
        },
      },
      duration: 6000,
    });
  }

  function onDelete(id: string) {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    // Optimistically remove from the list; only hit the API if the user
    // doesn't tap Undo within the toast window. This makes delete feel
    // like Gmail archive instead of a modal confirm dialog.
    setLeads((prev) => {
      const next = prev.filter((l) => l.id !== id);
      const counts: LeadCounts = { All: next.length, New: 0, "Called / No Response": 0, Scheduled: 0, Completed: 0, Lost: 0 };
      for (const l of next) counts[l.status] = (counts[l.status] ?? 0) + 1;
      onCounts?.(counts);
      return next;
    });
    const timer = setTimeout(async () => {
      pendingDeletes.current.delete(id);
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Restore in place and surface the error so nothing disappears silently.
        setLeads((prev) => (prev.some((l) => l.id === id) ? prev : [lead, ...prev]));
        toast({ kind: "error", message: "Couldn't delete. Restored." });
      }
    }, 5000);
    pendingDeletes.current.set(id, timer);
    toast({
      kind: "success",
      message: "Lead deleted",
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          const t = pendingDeletes.current.get(id);
          if (t) {
            clearTimeout(t);
            pendingDeletes.current.delete(id);
          }
          setLeads((prev) => {
            if (prev.some((l) => l.id === id)) return prev;
            const next = [lead, ...prev];
            const counts: LeadCounts = { All: next.length, New: 0, "Called / No Response": 0, Scheduled: 0, Completed: 0, Lost: 0 };
            for (const l of next) counts[l.status] = (counts[l.status] ?? 0) + 1;
            onCounts?.(counts);
            return next;
          });
        },
      },
    });
  }

  async function onAddRow() {
    const res = await fetch("/api/leads", { method: "POST" });
    if (res.ok) refresh({ silent: true });
  }

  async function onAddCalendar(lead: Lead) {
    if (!lead.scheduled_day) {
      toast({
        kind: "error",
        message: "Pick a Scheduled Day before adding to calendar.",
      });
      return;
    }
    const res = await fetch(`/api/leads/${lead.id}/calendar`, { method: "POST" });
    const json = await res.json();
    if (res.status === 428) {
      toast({
        kind: "info",
        message: "Google Calendar isn't connected.",
        duration: 6000,
        action: {
          label: "Connect",
          onClick: () => {
            window.location.href = json.connectUrl;
          },
        },
      });
      return;
    }
    if (!res.ok) {
      toast({ kind: "error", message: json.error ?? "Calendar failed" });
      return;
    }
    if (json.htmlLink) window.open(json.htmlLink, "_blank");
    toast({ kind: "success", message: "Estimate added to Calendar" });
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
              onAISchedule={() => {
                // Hand off to the /route page which renders a ghost pin for
                // the lead + a floating ranked-slots panel. Day param hints
                // which day to pre-rank (the customer's preferred day when
                // they have one, otherwise today).
                const day = lead.scheduled_day ?? "";
                const qs = new URLSearchParams({ scheduleLead: lead.id });
                if (day) qs.set("day", day);
                router.push(`/route?${qs.toString()}`);
              }}
            />
          ))}
        </div>
      )}

    </div>
  );
}

/* ---------------- Lead card ---------------- */

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
  settings,
}: {
  icon: React.ReactNode;
  tel?: boolean;
  email?: boolean;
  lead: Lead;
  field: "phone_number" | "email";
  onPatch: (p: Partial<Lead>) => void;
  settings: ClientAppSettings;
}) {
  const raw = (lead[field] ?? "") as string;
  const trimmed = raw.trim();
  const primaryHref = tel && trimmed
    ? `tel:${trimmed}`
    : email && trimmed
    ? buildMailtoHref(trimmed, lead, settings)
    : undefined;
  const smsHref = tel && trimmed ? buildSmsHref(trimmed, lead, settings) : undefined;

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
 * Salesperson picker — renders configured salespeople as tappable chips
 * and falls back to a free-text input for one-off names. Selecting a chip
 * immediately patches the lead so subsequent SMS / email templates see
 * the updated `{salesPerson}` placeholder.
 *
 * When `roster` is empty we render just the free-text input, preserving
 * the pre-settings behavior for users who haven't populated a roster yet.
 */
function SalespersonPicker({
  value,
  roster,
  onPatch,
}: {
  value: string;
  roster: string[];
  onPatch: (p: Partial<Lead>) => void;
}) {
  const trimmed = value.trim();
  const inRoster = roster.some(
    (n) => n.toLowerCase() === trimmed.toLowerCase()
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(trimmed && !inRoster ? trimmed : "");

  // Keep the input seeded with the current custom value when the lead
  // changes underneath us (e.g. polling or server patches).
  useEffect(() => {
    if (!trimmed) setDraft("");
    else if (!inRoster) setDraft(trimmed);
  }, [trimmed, inRoster]);

  function commit(next: string) {
    const n = next.trim();
    if (n === trimmed) return;
    onPatch({ sales_person: n === "" ? null : n });
  }

  return (
    <div className="flex-1 min-w-0 space-y-1.5">
      {roster.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {roster.map((name) => {
            const active = name.toLowerCase() === trimmed.toLowerCase();
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  commit(active ? "" : name);
                  setEditing(false);
                  setDraft("");
                }}
                className={cn(
                  "h-8 px-3 rounded-full text-xs font-medium transition-colors",
                  active
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-2)] text-[var(--fg)] hover:bg-slate-200"
                )}
              >
                {name}
              </button>
            );
          })}
          {!editing && !(trimmed && !inRoster) && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-8 px-3 rounded-full text-xs font-medium text-[var(--muted)] border border-dashed border-[var(--border)] hover:text-[var(--fg)]"
            >
              Other…
            </button>
          )}
        </div>
      )}
      {(roster.length === 0 || editing || (trimmed && !inRoster)) && (
        <input
          className="field-input w-full"
          value={draft}
          placeholder="Salesperson"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            commit(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
              setEditing(false);
            }
            if (e.key === "Escape") {
              setDraft(inRoster ? "" : trimmed);
              setEditing(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** Variable bag consumed by `renderTemplate`. Centralized so all
 *  channels (SMS intro, SMS confirm, email) see the same values. */
function templateVars(lead: Lead, settings: ClientAppSettings): TemplateVars {
  const first =
    (lead.first_name ?? "").trim() ||
    (lead.client ?? "").trim().split(" ")[0] ||
    "there";
  return {
    firstName: first,
    lastName: (lead.last_name ?? "").trim(),
    client: (lead.client ?? "").trim(),
    salesPerson: (lead.sales_person ?? "").trim(),
    companyName: (settings.company_name ?? "").trim(),
    companyPhone: (settings.company_phone ?? "").trim(),
    companyEmail: (settings.company_email ?? "").trim(),
    day: lead.scheduled_day ?? "",
    time: lead.scheduled_time ?? "",
  };
}

/**
 * Build the sms: link for a lead's first-touch text. Uses the user's
 * configured SMS intro template with `{firstName}`, `{salesPerson}`, and
 * company-name placeholder substitution.
 *
 * iOS and Android both honor `sms:<number>?body=<urlencoded>`.
 */
function buildSmsHref(phone: string, lead: Lead, settings: ClientAppSettings): string {
  const body = renderTemplate(smsIntroTemplate(settings), templateVars(lead, settings));
  return `sms:${phone}?body=${encodeURIComponent(body)}`;
}

/** Build the mailto: href — subject + body come from the user's
 *  configured email template. */
function buildMailtoHref(email: string, lead: Lead, settings: ClientAppSettings): string {
  const vars = templateVars(lead, settings);
  const subject = renderTemplate(emailSubjectTemplate(settings), vars);
  const body = renderTemplate(emailBodyTemplate(settings), vars);
  const q = new URLSearchParams({ subject, body }).toString();
  return `mailto:${email}?${q}`;
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
  // `pending` holds the most recent unsaved value so `flush()` can fire
  // the patch synchronously without depending on `local`'s closure.
  const pending = useRef<string | null>(null);
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    const patch: Partial<Lead> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (patch as any)[field] = next === "" ? null : next;
    onPatchRef.current(patch);
  }, [field]);

  // Fire any pending save when the tab hides, the page unloads, or the
  // input blurs. Without this, a quick edit + tap-home swallows the patch
  // because the 500 ms debounce timer never resolves in the background.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") flush();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  // Final safety net: flush on unmount too.
  useEffect(() => {
    return () => flush();
  }, [flush]);

  function scheduleSave(next: string) {
    setLocal(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
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
        onBlur={flush}
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
      onBlur={flush}
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
