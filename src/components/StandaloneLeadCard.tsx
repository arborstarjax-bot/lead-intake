"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LeadCard } from "@/components/LeadTable";
import { useToast } from "@/components/Toast";
import type { Lead } from "@/lib/types";

/**
 * Renders a single LeadCard outside the /leads table (e.g. right after
 * uploading a screenshot, or inside the Manual Entry tab). Keeps local
 * state for that one lead and wires its callbacks to the same REST
 * endpoints the main leads table uses.
 *
 * `pending` mode: the card represents a brand-new manual lead that
 * hasn't hit the database yet. Nothing is persisted until the user
 * types their first value — the POST happens from inside `savePatch`
 * and subsequent patches are PATCHes as normal. Deleting a pending
 * lead just drops it from local state with no API round-trip, so
 * mis-taps on "Start a new lead" never leave ghost rows behind.
 */
export default function StandaloneLeadCard({
  initialLead,
  onRemoved,
  pending = false,
}: {
  initialLead: Lead;
  onRemoved?: (id: string) => void;
  pending?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [lead, setLead] = useState<Lead>(initialLead);
  const [isPending, setIsPending] = useState(pending);
  const [deleted, setDeleted] = useState(false);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Coalesce concurrent patches while the initial POST is in-flight so
  // two quick edits on a pending card don't race into two creates.
  const createInFlight = useRef<Promise<Lead | null> | null>(null);

  async function createFromPending(patch: Partial<Lead>): Promise<Lead | null> {
    if (createInFlight.current) return createInFlight.current;
    const promise = (async () => {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (res.ok && json.lead) {
        const created = json.lead as Lead;
        setLead(created);
        setIsPending(false);
        return created;
      }
      toast({ kind: "error", message: json.error ?? "Couldn't save" });
      return null;
    })().finally(() => {
      createInFlight.current = null;
    });
    createInFlight.current = promise;
    return promise;
  }

  async function savePatch(patch: Partial<Lead>) {
    const prev = lead;
    // Optimistic update so typing feels instant; snap back on error.
    setLead({ ...prev, ...patch });

    if (isPending) {
      // First keystroke on a manual-entry card — persist the lead now.
      const created = await createFromPending({ ...patch });
      if (!created) setLead(prev);
      return;
    }

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
      toast({ kind: "error", message: json.error ?? "Save failed" });
    }
  }

  function onDelete() {
    const snapshot = lead;
    // Unsaved manual card — nothing to delete on the server.
    if (isPending) {
      setDeleted(true);
      onRemoved?.(snapshot.id);
      return;
    }
    setDeleted(true);
    const timer = setTimeout(async () => {
      deleteTimer.current = null;
      const res = await fetch(`/api/leads/${snapshot.id}`, { method: "DELETE" });
      if (res.ok) {
        onRemoved?.(snapshot.id);
      } else {
        setDeleted(false);
        toast({ kind: "error", message: "Couldn't delete. Restored." });
      }
    }, 5000);
    deleteTimer.current = timer;
    toast({
      kind: "success",
      message: "Lead deleted",
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          if (deleteTimer.current) {
            clearTimeout(deleteTimer.current);
            deleteTimer.current = null;
          }
          setDeleted(false);
        },
      },
    });
  }

  async function onAddCalendar() {
    if (isPending) {
      toast({
        kind: "error",
        message: "Save this lead first, then add it to the calendar.",
      });
      return;
    }
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
    // Refresh the lead so the "Lead Scheduled" pill appears.
    const refreshed = await fetch(`/api/leads?view=all`).then((r) => r.json());
    const updated = (refreshed.leads ?? []).find((l: Lead) => l.id === lead.id);
    if (updated) setLead(updated);
    toast({ kind: "success", message: "Estimate added to Calendar" });
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
        if (isPending) {
          toast({
            kind: "error",
            message: "Save this lead first, then find a time.",
          });
          return;
        }
        const day = lead.scheduled_day ?? "";
        const qs = new URLSearchParams({ scheduleLead: lead.id });
        if (day) qs.set("day", day);
        router.push(`/route?${qs.toString()}`);
      }}
    />
  );
}
