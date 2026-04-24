"use client";

import { useEffect, useState } from "react";
import type { LeadPatch } from "@/modules/leads/model";
import { cn } from "@/lib/utils";

/**
 * Salesperson picker — renders configured salespeople as tappable chips
 * and falls back to a free-text input for one-off names. Selecting a chip
 * immediately patches the lead so subsequent SMS / email templates see
 * the updated `{salesPerson}` placeholder.
 *
 * When `roster` is empty we render just the free-text input, preserving
 * the pre-settings behavior for users who haven't populated a roster yet.
 */
export function SalespersonPicker({
  value,
  roster,
  onPatch,
}: {
  value: string;
  roster: string[];
  onPatch: (p: LeadPatch) => void;
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
