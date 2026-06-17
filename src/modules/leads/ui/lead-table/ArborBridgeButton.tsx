"use client";

import { useState } from "react";
import { Navigation } from "lucide-react";
import type { Lead } from "@/modules/leads/model";

export function ArborBridgeButton({
  lead,
  onDone,
}: {
  lead: Lead;
  onDone: () => void;
}) {
  const [pushing, setPushing] = useState(false);

  async function handlePush() {
    if (!confirm("Push this lead to ArborBridge?")) return;

    setPushing(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/arborbridge`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        alert("Lead pushed to ArborBridge successfully.");
      } else {
        alert(`Push failed: ${data.error || "Unknown error"}`);
      }
    } catch {
      alert("Network error pushing to ArborBridge.");
    } finally {
      setPushing(false);
      onDone();
    }
  }

  const statusLabel =
    lead.arborbridge_status === "pushed_to_arborbridge"
      ? "Pushed"
      : lead.arborbridge_status === "push_failed"
        ? "Failed"
        : null;

  return (
    <button
      onClick={handlePush}
      disabled={pushing}
      className="flex w-full items-center gap-2 px-3 py-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
    >
      <Navigation className="h-4 w-4 text-green-600" />
      <span>
        {pushing ? "Pushing..." : "Push to ArborBridge"}
        {statusLabel && (
          <span className="ml-1 text-xs text-[var(--muted)]">({statusLabel})</span>
        )}
      </span>
    </button>
  );
}
