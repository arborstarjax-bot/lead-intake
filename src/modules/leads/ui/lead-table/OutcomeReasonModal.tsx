"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import {
  OUTCOME_REASONS,
  type OutcomeReason,
  type LeadPatch,
} from "@/modules/leads/model";
import { cn } from "@/lib/utils";

export function OutcomeReasonModal({
  leadName,
  outcomeLabel,
  onSubmit,
  onCancel,
}: {
  leadName: string;
  outcomeLabel: "Lost" | "Not Sold";
  onSubmit: (patch: LeadPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<OutcomeReason | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = reason && (reason !== "Other" || notes.trim());

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const patch: LeadPatch =
        outcomeLabel === "Lost"
          ? {
              status: "Lost",
              follow_up_result: reason,
              follow_up_notes: reason === "Other" ? notes || null : null,
              outcome_badge: "Lost",
            }
          : {
              status: "Completed",
              estimate_outcome: "Not Sold",
              outcome_badge: "Not Sold",
              follow_up_result: reason,
              follow_up_notes: reason === "Other" ? notes || null : null,
            };
      await onSubmit(patch);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {leadName}
            </div>
            <div className="font-semibold text-[15px]">
              Mark as {outcomeLabel}
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex items-center justify-center h-10 w-10 -mr-2 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <p className="text-sm text-[var(--muted)] mb-3">
            Why is this lead being marked {outcomeLabel.toLowerCase()}?
          </p>
          {OUTCOME_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={cn(
                "w-full text-left rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                reason === r
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface)]"
              )}
            >
              {r}
            </button>
          ))}
          {reason === "Other" && (
            <textarea
              autoFocus
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the reason…"
              className="w-full mt-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-y"
            />
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-[var(--border)]">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors",
              canSubmit && !submitting
                ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                : "bg-gray-300 cursor-not-allowed"
            )}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
