"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import {
  FOLLOW_UP_RESULTS,
  type FollowUpResult,
  type LeadPatch,
  type OutcomeBadge,
} from "@/modules/leads/model";
import { cn } from "@/lib/utils";

export function FollowUpModal({
  leadName,
  onSubmit,
  onCancel,
}: {
  leadName: string;
  onSubmit: (patch: LeadPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const [result, setResult] = useState<FollowUpResult | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = result && (result !== "Other" || notes.trim());

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        status: "Called / No Response",
        follow_up_result: result,
        follow_up_notes: result === "Other" ? notes || null : null,
        outcome_badge: deriveBadge(result),
      });
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
            <div className="font-semibold text-[15px]">Log Follow-Up</div>
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
            What&apos;s the current follow-up status?
          </p>
          {FOLLOW_UP_RESULTS.map((r) => (
            <button
              key={r}
              onClick={() => setResult(r)}
              className={cn(
                "w-full text-left rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                result === r
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-white text-[var(--fg)] hover:bg-[var(--surface)]"
              )}
            >
              {r}
            </button>
          ))}
          {result === "Other" && (
            <textarea
              autoFocus
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the follow-up…"
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
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function deriveBadge(result: FollowUpResult): OutcomeBadge {
  if (result === "Proposal Revision Requested") return "Proposal Revision Requested";
  if (result === "Requested Callback") return "Requested Callback";
  return "Needs Follow-Up";
}
