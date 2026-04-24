"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { LeadCard } from "@/modules/leads";
import { useToast } from "@/components/Toast";
import { fetchWithOfflineQueue } from "@/modules/offline";
import { formatLeadPatchError, patchLead } from "@/modules/offline";
import type { DuplicateMatch } from "@/modules/leads";
import type { Lead, LeadPatch } from "@/modules/leads/model";

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
  duplicates,
}: {
  initialLead: Lead;
  onRemoved?: (id: string) => void;
  pending?: boolean;
  /**
   * Possible duplicate leads flagged at ingest time. Rendered as a
   * warning banner above the card with links to the colliding leads
   * so the user can merge or dismiss. Only passed for cards rendered
   * right after an upload — loaded-from-DB cards don't surface dupes
   * because the collision check only makes sense at insert time.
   */
  duplicates?: DuplicateMatch[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [lead, setLead] = useState<Lead>(initialLead);
  const [isPending, setIsPending] = useState(pending);
  const [deleted, setDeleted] = useState(false);
  // Let the user dismiss the "possible duplicate" banner once they've
  // looked at the other lead and decided the new one is genuinely
  // different. We don't persist this — a fresh page load will re-show
  // the banner from the ingest response — but that's fine since the
  // banner is only ever rendered on the just-uploaded card.
  const [dupesDismissed, setDupesDismissed] = useState(false);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The parent tracks manual leads by their original `pending-xxx` id.
  // After the first POST swaps it for the server UUID the parent can no
  // longer match, so we keep the original around for onRemoved.
  const originalId = useRef(initialLead.id);
  // Guard against double-creation when two patches race during the initial
  // POST. The first caller owns the create; later callers wait on the same
  // promise and then replay their patch as a PATCH against the real id.
  const createInFlight = useRef<Promise<Lead | null> | null>(null);

  async function createFromPending(patch: LeadPatch): Promise<Lead | null> {
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

  async function patchExisting(
    id: string,
    patch: LeadPatch,
    prev: Lead
  ): Promise<void> {
    const res = await patchLead(id, patch, prev, {
      offlineQueue: true,
      label: `Edit lead ${id.slice(0, 6)}`,
    });
    if (res.headers.get("x-offline-queued") === "1") {
      // Keep the optimistic state from the caller — the replayer will
      // sync when the tab regains network.
      toast({ kind: "info", message: "Saved offline — will sync when online" });
      return;
    }
    const json = await res.json();
    if (res.ok && json.lead) {
      setLead(json.lead as Lead);
      return;
    }
    // Stale-write rejection: server returned the latest row, drop our
    // in-flight edit in favor of it and tell the user to retry.
    if (res.status === 409 && json.reason === "stale_write" && json.lead) {
      setLead(json.lead as Lead);
      toast({ kind: "error", message: formatLeadPatchError(res, json), duration: 6000 });
      return;
    }
    setLead(prev);
    toast({ kind: "error", message: formatLeadPatchError(res, json) });
  }

  async function savePatch(patch: LeadPatch) {
    const prev = lead;
    // Optimistic update so typing feels instant; snap back on error.
    // Strip envelope keys (`extraction_confidence_merge`,
    // `expected_updated_at`) so they don't leak onto the Lead object,
    // and apply the confidence merge locally for immediate UI feedback.
    const {
      extraction_confidence_merge: confMerge,
      expected_updated_at: _ignore,
      ...rest
    } = patch;
    void _ignore;
    const optimistic: Lead = { ...prev, ...rest } as Lead;
    if (confMerge) {
      const existingConf = (prev.extraction_confidence ?? {}) as Record<
        string,
        number
      >;
      const merged: Record<string, number> = { ...existingConf };
      for (const [k, v] of Object.entries(confMerge)) {
        if (typeof v === "number" && isFinite(v) && v >= 0 && v <= 1) {
          merged[k] = v;
        } else if (v === null) {
          delete merged[k];
        }
      }
      optimistic.extraction_confidence = merged;
    }
    setLead(optimistic);

    if (isPending || createInFlight.current) {
      // If a POST is already in-flight we must not fire a second one —
      // but we also must not silently drop this caller's new fields.
      // Wait for the create, then replay this patch against the real id.
      const alreadyCreating = Boolean(createInFlight.current);
      const created = alreadyCreating
        ? await createInFlight.current
        : await createFromPending({ ...patch });
      if (!created) {
        setLead(prev);
        return;
      }
      // The very first caller's patch is included in the POST body, so
      // only replay if we piggy-backed on someone else's in-flight create.
      if (alreadyCreating) {
        await patchExisting(created.id, patch, optimistic);
      }
      return;
    }

    await patchExisting(prev.id, patch, prev);
  }

  function onDelete() {
    const snapshot = lead;
    // Unsaved manual card — nothing to delete on the server.
    if (isPending) {
      setDeleted(true);
      onRemoved?.(originalId.current);
      return;
    }
    setDeleted(true);
    const timer = setTimeout(async () => {
      deleteTimer.current = null;
      // Route through the offline queue so a delete started on a flaky
      // connection survives a reload — the card is already hidden
      // locally; the queued DELETE replays once the tab is online.
      const res = await fetchWithOfflineQueue(
        `/api/leads/${snapshot.id}`,
        {
          method: "DELETE",
          label: `Delete lead ${snapshot.id.slice(0, 6)}`,
        }
      );
      if (res.headers.get("x-offline-queued") === "1") {
        onRemoved?.(originalId.current);
        toast({
          kind: "info",
          message: "Deleted offline — will sync when online",
        });
        return;
      }
      if (res.ok) {
        onRemoved?.(originalId.current);
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

  const showDupes =
    !dupesDismissed && duplicates && duplicates.length > 0;

  return (
    <div className="space-y-2">
      {showDupes && (
        <DuplicateWarning
          duplicates={duplicates!}
          onDismiss={() => setDupesDismissed(true)}
        />
      )}
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
    </div>
  );
}

/**
 * Inline banner shown on a just-uploaded lead card when the ingest
 * pipeline flagged potential duplicates. Hard matches (phone/email)
 * render in amber with stronger wording; soft matches (address/name)
 * render with softer copy so we don't drown the user in false-alarm
 * warnings on common names/addresses.
 */
function DuplicateWarning({
  duplicates,
  onDismiss,
}: {
  duplicates: DuplicateMatch[];
  onDismiss: () => void;
}) {
  const hard = duplicates.filter(
    (d) => d.reason === "phone" || d.reason === "email"
  );
  const soft = duplicates.filter(
    (d) => d.reason === "address" || d.reason === "name"
  );
  // Dedupe: the same existing lead can appear twice if it matches on
  // both phone AND address. Collapse to one entry per lead id, keeping
  // the hardest reason.
  const byId = new Map<string, DuplicateMatch>();
  for (const m of [...hard, ...soft]) {
    if (!byId.has(m.lead.id)) byId.set(m.lead.id, m);
  }
  const rows = Array.from(byId.values());
  const hasHard = hard.length > 0;

  return (
    <div
      role="status"
      className={`rounded-xl border px-3 py-2.5 text-sm space-y-1.5 ${
        hasHard
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg)]"
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={`h-4 w-4 mt-0.5 shrink-0 ${
            hasHard ? "text-amber-600" : "text-[var(--muted)]"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {hasHard
              ? rows.length === 1
                ? "Possible duplicate client"
                : `Possible duplicate of ${rows.length} existing leads`
              : "Similar existing lead"}
          </div>
          <ul className="mt-1 space-y-0.5">
            {rows.map((m) => {
              const name =
                [m.lead.first_name, m.lead.last_name]
                  .filter(Boolean)
                  .join(" ") || "Unnamed lead";
              return (
                <li key={m.lead.id} className="flex items-center gap-2">
                  <Link
                    href={`/leads/${m.lead.id}`}
                    className="underline underline-offset-2 font-medium truncate"
                  >
                    {name}
                  </Link>
                  <span className="text-xs text-[var(--muted)]">
                    · matches {reasonLabel(m.reason)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium underline underline-offset-2 shrink-0 opacity-80 hover:opacity-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function reasonLabel(reason: DuplicateMatch["reason"]): string {
  switch (reason) {
    case "phone":
      return "phone number";
    case "email":
      return "email";
    case "address":
      return "address";
    case "name":
      return "name";
  }
}
