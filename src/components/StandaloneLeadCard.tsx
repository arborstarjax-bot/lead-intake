"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LeadCard } from "@/components/LeadTable";
import type { Lead } from "@/lib/types";

/**
 * Renders a single LeadCard outside the /leads table (e.g. right after
 * uploading a screenshot, or inside the Manual Entry tab). Keeps local
 * state for that one lead and wires its callbacks to the same REST
 * endpoints the main leads table uses.
 */
export default function StandaloneLeadCard({
  initialLead,
  onRemoved,
}: {
  initialLead: Lead;
  onRemoved?: (id: string) => void;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<Lead>(initialLead);
  const [deleted, setDeleted] = useState(false);

  async function savePatch(patch: Partial<Lead>) {
    const prev = lead;
    // Optimistic update so typing feels instant; snap back on error.
    setLead({ ...prev, ...patch });
    const res = await fetch(`/api/leads/${prev.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (res.ok && json.lead) {
      setLead(json.lead as Lead);
    } else {
      setLead(prev);
      alert(json.error ?? "Save failed");
    }
  }

  async function onDelete() {
    if (
      !confirm(
        "Delete this lead permanently? Use Completed instead if you want to keep history."
      )
    )
      return;
    const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
    if (res.ok) {
      setDeleted(true);
      onRemoved?.(lead.id);
    }
  }

  async function onAddCalendar() {
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
    // Refresh the lead so the "Lead Scheduled" pill appears.
    const refreshed = await fetch(`/api/leads?view=all`).then((r) => r.json());
    const updated = (refreshed.leads ?? []).find((l: Lead) => l.id === lead.id);
    if (updated) setLead(updated);
  }

  if (deleted) return null;

  return (
    <LeadCard
      lead={lead}
      onPatch={savePatch}
      onDelete={onDelete}
      onAddCalendar={onAddCalendar}
      onToggleComplete={() => savePatch({ status: "Completed" })}
      onAISchedule={() => {
        const day = lead.scheduled_day ?? "";
        const qs = new URLSearchParams({ scheduleLead: lead.id });
        if (day) qs.set("day", day);
        router.push(`/route?${qs.toString()}`);
      }}
    />
  );
}
