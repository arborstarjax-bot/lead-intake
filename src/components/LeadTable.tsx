"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone,
  Mail,
  CalendarPlus,
  CalendarCheck,
  Trash2,
  Image as ImageIcon,
  Undo2,
  Plus,
  Search,
} from "lucide-react";
import type { Lead, LeadStatus } from "@/lib/types";
import { LEAD_STATUSES, EDITABLE_COLUMNS } from "@/lib/types";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

type Column = {
  key: keyof Lead;
  label: string;
  width: string;
  type?: "text" | "date" | "time" | "select" | "textarea";
};

const COLUMNS: Column[] = [
  { key: "status", label: "Status", width: "min-w-[170px]", type: "select" },
  { key: "date", label: "Date", width: "min-w-[120px]", type: "date" },
  { key: "client", label: "Client Name", width: "min-w-[180px]" },
  { key: "phone_number", label: "Phone", width: "min-w-[150px]" },
  { key: "email", label: "Email", width: "min-w-[200px]" },
  { key: "address", label: "Address", width: "min-w-[180px]" },
  { key: "city", label: "City", width: "min-w-[120px]" },
  { key: "state", label: "State", width: "min-w-[70px]" },
  { key: "zip", label: "Zip", width: "min-w-[90px]" },
  { key: "sales_person", label: "Sales Person", width: "min-w-[140px]" },
  { key: "scheduled_day", label: "Sched. Day", width: "min-w-[130px]", type: "date" },
  { key: "scheduled_time", label: "Sched. Time", width: "min-w-[110px]", type: "time" },
  { key: "notes", label: "Notes", width: "min-w-[260px]", type: "textarea" },
];

export default function LeadTable({
  view,
  onCounts,
}: {
  view: "active" | "completed";
  onCounts?: (n: { active: number; completed: number }) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof Lead>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [toast, setToast] = useState<{ leadId: string; prev: LeadStatus } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function showFlash(message: string) {
    setFlash(message);
    setTimeout(() => setFlash((f) => (f === message ? null : f)), 3_000);
  }

  async function refresh() {
    setLoading(true);
    const [a, c] = await Promise.all([
      fetch(`/api/leads?view=active`).then((r) => r.json()),
      fetch(`/api/leads?view=completed`).then((r) => r.json()),
    ]);
    const activeLeads: Lead[] = a.leads ?? [];
    const completedLeads: Lead[] = c.leads ?? [];
    setLeads(view === "active" ? activeLeads : completedLeads);
    onCounts?.({ active: activeLeads.length, completed: completedLeads.length });
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? leads.filter((l) =>
          EDITABLE_COLUMNS.some((k) => {
            const v = l[k];
            return typeof v === "string" && v.toLowerCase().includes(q);
          })
        )
      : leads.slice();
    rows.sort((a, b) => {
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return rows;
  }, [leads, search, sortKey, sortAsc]);

  async function savePatch(id: string, patch: Partial<Lead>) {
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (res.ok && json.lead) {
      setLeads((prev) => {
        // When status changes to/from Completed, the row may need to leave
        // this view; filter it out accordingly.
        const shouldStay =
          view === "active"
            ? json.lead.status !== "Completed"
            : json.lead.status === "Completed";
        const withoutOld = prev.filter((l) => l.id !== id);
        return shouldStay ? [json.lead, ...withoutOld.filter((l) => l.id !== id)] : withoutOld;
      });
      refresh();
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
    if (!confirm("Delete this lead permanently? Use Completed instead if you want to keep history.")) return;
    await fetch(`/api/leads/${id}`, { method: "DELETE" });
    refresh();
  }

  async function onAddRow() {
    const res = await fetch("/api/leads", { method: "POST" });
    if (res.ok) refresh();
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
    refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="w-full rounded-lg border border-[var(--border)] pl-8 pr-3 py-2 bg-white"
          />
        </div>
        <button
          onClick={onAddRow}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> Row
        </button>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white overflow-hidden">
        <div className="overflow-auto">
          <table className="min-w-max w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 bg-gray-50 border-b border-[var(--border)] px-2 py-2 text-left w-[52px]">
                  <span className="sr-only">Calendar</span>
                </th>
                <th className="border-b border-[var(--border)] px-2 py-2 text-left font-medium w-[56px]">
                  Done
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key as string}
                    className={cn(
                      "border-b border-[var(--border)] px-3 py-2 text-left font-medium",
                      c.width
                    )}
                  >
                    <button
                      className="inline-flex items-center gap-1"
                      onClick={() => {
                        if (sortKey === c.key) setSortAsc((v) => !v);
                        else {
                          setSortKey(c.key);
                          setSortAsc(true);
                        }
                      }}
                    >
                      {c.label}
                      {sortKey === c.key && <span>{sortAsc ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ))}
                <th className="border-b border-[var(--border)] px-2 py-2 w-[96px]"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="p-6 text-center text-[var(--muted)]">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="p-10 text-center text-[var(--muted)]">
                    {view === "active"
                      ? "No active leads yet. Upload a screenshot above."
                      : "No completed leads yet."}
                  </td>
                </tr>
              )}
              {filtered.map((lead) => (
                <Row
                  key={lead.id}
                  lead={lead}
                  onPatch={(p) => savePatch(lead.id, p)}
                  onDelete={() => onDelete(lead.id)}
                  onAddCalendar={() => onAddCalendar(lead)}
                  onToggleComplete={() => onMarkCompleted(lead)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-[var(--fg)] text-white px-4 py-2 shadow-lg text-sm">
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
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-600 text-white px-4 py-2 shadow-lg text-sm">
            <CalendarCheck className="h-4 w-4" />
            {flash}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  lead,
  onPatch,
  onDelete,
  onAddCalendar,
  onToggleComplete,
}: {
  lead: Lead;
  onPatch: (p: Partial<Lead>) => void;
  onDelete: () => void;
  onAddCalendar: () => void;
  onToggleComplete: () => void;
}) {
  const canCalendar = Boolean(lead.scheduled_day);
  const needsReview = lead.intake_status === "needs_review" || lead.intake_status === "failed";

  // "Lead Scheduled": a Google event already exists AND the lead's scheduled
  // day/time still match what was synced. Changing either field puts the
  // row back in a "needs resync" state so the button re-enables.
  const scheduledInSync =
    Boolean(lead.calendar_event_id) &&
    lead.calendar_scheduled_day === lead.scheduled_day &&
    (lead.calendar_scheduled_time ?? null) === (lead.scheduled_time ?? null);
  const needsResync = Boolean(lead.calendar_event_id) && !scheduledInSync;

  return (
    <tr className={cn("odd:bg-white even:bg-gray-50", needsReview && "bg-amber-50")}>
      <td className="sticky left-0 z-10 bg-inherit border-b border-[var(--border)] px-1 py-1 align-middle">
        {scheduledInSync ? (
          <span
            title="Calendar event created. Change Scheduled Day/Time to resync."
            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 h-9 text-xs font-medium text-emerald-700 whitespace-nowrap"
          >
            <CalendarCheck className="h-4 w-4" />
            Lead Scheduled
          </span>
        ) : (
          <button
            onClick={onAddCalendar}
            disabled={!canCalendar}
            title={
              needsResync
                ? "Scheduled time changed — click to update calendar event"
                : canCalendar
                ? "Add to Google Calendar"
                : "Set Scheduled Day first"
            }
            className={cn(
              "inline-flex items-center justify-center h-9 w-9 rounded-md border",
              needsResync
                ? "border-amber-500 text-amber-700 hover:bg-amber-50"
                : canCalendar
                ? "border-[var(--accent)] text-[var(--accent)] hover:bg-blue-50"
                : "border-[var(--border)] text-[var(--muted)] opacity-50 cursor-not-allowed"
            )}
          >
            <CalendarPlus className="h-4 w-4" />
          </button>
        )}
      </td>
      <td className="border-b border-[var(--border)] px-2 py-1 align-middle text-center">
        <input
          type="checkbox"
          aria-label="Mark complete"
          title={lead.status === "Completed" ? "Completed" : "Mark complete"}
          checked={lead.status === "Completed"}
          onChange={() => {
            if (lead.status === "Completed") {
              onPatch({ status: "New" });
            } else {
              onToggleComplete();
            }
          }}
          className="h-5 w-5 cursor-pointer accent-emerald-600"
        />
      </td>
      {COLUMNS.map((c) => (
        <Cell key={c.key as string} column={c} lead={lead} onPatch={onPatch} />
      ))}
      <td className="border-b border-[var(--border)] px-2 py-2 whitespace-nowrap align-middle">
        <div className="flex items-center gap-1 justify-end">
          {needsReview && (
            <span className="text-xs text-amber-700 mr-1">review</span>
          )}
          {lead.screenshot_path && (
            <a
              href={`/api/leads/${lead.id}/screenshot`}
              target="_blank"
              rel="noreferrer"
              title="View original screenshot"
              className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--muted)] hover:bg-gray-100"
            >
              <ImageIcon className="h-4 w-4" />
            </a>
          )}
          <button
            onClick={onDelete}
            title="Delete lead"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[var(--muted)] hover:bg-red-50 hover:text-[var(--danger)]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function Cell({
  column,
  lead,
  onPatch,
}: {
  column: Column;
  lead: Lead;
  onPatch: (p: Partial<Lead>) => void;
}) {
  const initial = lead[column.key];
  const [value, setValue] = useState<string>(initial ? String(initial) : "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(initial ? String(initial) : "");
  }, [initial]);

  function scheduleSave(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const patch: Partial<Lead> = {};
      // Treat empty string as null so the column clears cleanly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[column.key] = next === "" ? null : next;
      onPatch(patch);
    }, 500);
  }

  const conf = lead.extraction_confidence?.[column.key as string];
  const lowConf = typeof conf === "number" && conf > 0 && conf < 0.6 && value;

  const display =
    column.key === "phone_number" && value ? formatPhone(value) : value;

  const cellClass = cn(
    "cell-input",
    lowConf && "bg-amber-50 border-amber-300"
  );

  const isPhone = column.key === "phone_number";
  const isEmail = column.key === "email";
  const hasPhone = isPhone && Boolean(value.trim());
  const hasEmail = isEmail && Boolean(value.trim());

  return (
    <td
      className={cn(
        "border-b border-[var(--border)] align-top",
        column.width,
        lowConf && "bg-amber-50"
      )}
      title={lowConf ? `Low confidence (${Math.round((conf ?? 0) * 100)}%)` : undefined}
    >
      {column.type === "select" ? (
        <select
          value={value || "New"}
          onChange={(e) => {
            setValue(e.target.value);
            onPatch({ status: e.target.value as LeadStatus });
          }}
          className={cellClass}
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : column.type === "textarea" ? (
        <textarea
          value={display}
          rows={2}
          onChange={(e) => scheduleSave(e.target.value)}
          className={cn(cellClass, "resize-y")}
        />
      ) : isPhone || isEmail ? (
        <div className="flex items-center gap-1 pl-1">
          <a
            href={
              hasPhone
                ? `tel:${value}`
                : hasEmail
                ? `mailto:${value}`
                : undefined
            }
            aria-disabled={isPhone ? !hasPhone : !hasEmail}
            onClick={(e) => {
              if (isPhone ? !hasPhone : !hasEmail) e.preventDefault();
            }}
            title={isPhone ? "Call" : "Email"}
            className={cn(
              "inline-flex items-center justify-center h-7 w-7 shrink-0 rounded-md border",
              (isPhone ? hasPhone : hasEmail)
                ? "border-[var(--accent)] text-[var(--accent)] hover:bg-blue-50"
                : "border-[var(--border)] text-[var(--muted)] opacity-40 cursor-not-allowed"
            )}
          >
            {isPhone ? <Phone className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
          </a>
          <input
            type="text"
            value={isPhone ? display : value}
            inputMode={isPhone ? "tel" : "email"}
            onChange={(e) => scheduleSave(e.target.value)}
            className={cellClass}
          />
        </div>
      ) : (
        <input
          type={column.type ?? "text"}
          value={display}
          onChange={(e) => scheduleSave(e.target.value)}
          className={cellClass}
        />
      )}
    </td>
  );
}
