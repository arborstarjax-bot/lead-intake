"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import type { Lead, LeadStatus } from "@/lib/types";
import { EDITABLE_COLUMNS, LEAD_STATUS_LABELS } from "@/lib/types";
import { fetchWithOfflineQueue } from "@/lib/offline-queue";
import { useToast } from "@/components/Toast";
import { useAppSettings } from "@/components/SettingsProvider";
import { LeadCard } from "./lead-table/LeadCard";

const UNASSIGNED = "__unassigned__";

export { LeadCard } from "./lead-table/LeadCard";

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
  const { settings } = useAppSettings();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Salesperson filter: "" = all, UNASSIGNED = leads with no salesperson,
  // any other string = exact (case-insensitive) match against sales_person.
  const [salespersonFilter, setSalespersonFilter] = useState<string>("");
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

  // Build the salesperson filter options from the union of (a) any
  // salesperson currently assigned to a lead and (b) the configured
  // roster. Keeps the dropdown stable even when no lead is assigned to a
  // given person yet, and grows naturally as new names appear on leads.
  const salespersonOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const l of leads) {
      const name = (l.sales_person ?? "").trim();
      if (!name) continue;
      byKey.set(name.toLowerCase(), name);
    }
    for (const name of settings.salespeople ?? []) {
      const n = name.trim();
      if (!n) continue;
      if (!byKey.has(n.toLowerCase())) byKey.set(n.toLowerCase(), n);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [leads, settings.salespeople]);

  const hasUnassigned = useMemo(
    () => leads.some((l) => !(l.sales_person ?? "").trim()),
    [leads]
  );

  const filtered = useMemo(() => {
    const byStatus = filter === "All" ? leads : leads.filter((l) => l.status === filter);
    const byPerson = salespersonFilter
      ? byStatus.filter((l) => {
          const p = (l.sales_person ?? "").trim();
          if (salespersonFilter === UNASSIGNED) return p === "";
          return p.toLowerCase() === salespersonFilter.toLowerCase();
        })
      : byStatus;
    const q = search.trim().toLowerCase();
    if (!q) return byPerson;
    return byPerson.filter((l) =>
      EDITABLE_COLUMNS.some((k) => {
        const v = l[k];
        return typeof v === "string" && v.toLowerCase().includes(q);
      })
    );
  }, [leads, search, filter, salespersonFilter]);

  async function savePatch(id: string, patch: Partial<Lead>): Promise<boolean> {
    const res = await fetchWithOfflineQueue(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      label: `Edit lead ${id.slice(0, 6)}`,
    });
    // Offline queue path: request didn't reach the server but is stashed
    // for replay. Optimistically merge the patch into local state so the
    // UI reflects the user's intent — OfflineQueueReplayer will
    // router.refresh() once the write actually lands.
    if (res.headers.get("x-offline-queued") === "1") {
      setLeads((prev) => {
        const counts: LeadCounts = {
          All: 0,
          New: 0,
          "Called / No Response": 0,
          Scheduled: 0,
          Completed: 0,
          Lost: 0,
        };
        const next = prev.map((l) => (l.id === id ? { ...l, ...patch } : l));
        counts.All = next.length;
        for (const l of next) counts[l.status] = (counts[l.status] ?? 0) + 1;
        onCounts?.(counts);
        return next;
      });
      if ("scheduled_time" in patch || "scheduled_day" in patch) {
        onScheduleChange?.();
      }
      toast({ kind: "info", message: "Saved offline — will sync when online" });
      return true;
    }
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
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--subtle)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 py-2.5 text-[15px] shadow-sm focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(5,150,105,0.15)]"
          />
        </div>
        <select
          aria-label="Filter by salesperson"
          value={salespersonFilter}
          onChange={(e) => setSalespersonFilter(e.target.value)}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-medium shadow-sm focus:outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(5,150,105,0.15)] max-w-[12rem]"
        >
          <option value="">All salespeople</option>
          {salespersonOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {hasUnassigned && (
            <option value={UNASSIGNED}>(Unassigned)</option>
          )}
        </select>
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
            : `No leads in "${LEAD_STATUS_LABELS[filter]}" yet.`}
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
