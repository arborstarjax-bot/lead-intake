"use client";

import { useState } from "react";
import {
  X,
  CheckCircle2,
  FileX2,
  DollarSign,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import {
  NO_PROPOSAL_REASONS,
  FOLLOW_UP_RESULTS,
  type EstimateOutcome,
  type NoProposalReason,
  type FollowUpResult,
  type LeadPatch,
  type OutcomeBadge,
} from "@/modules/leads/model";
import { cn } from "@/lib/utils";

type Step = "primary" | "proposal_result" | "no_proposal_reason" | "follow_up";

export function EstimateOutcomeModal({
  leadName,
  onSubmit,
  onCancel,
}: {
  leadName: string;
  onSubmit: (patch: LeadPatch) => Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>("primary");
  const [outcome, setOutcome] = useState<EstimateOutcome | null>(null);
  const [noProposalReason, setNoProposalReason] = useState<NoProposalReason | null>(null);
  const [noProposalNotes, setNoProposalNotes] = useState("");
  const [followUpResult, setFollowUpResult] = useState<FollowUpResult | null>(null);
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function deriveBadge(): OutcomeBadge {
    if (outcome === "Sold") return "Sold";
    if (outcome === "Not Sold") return "Not Sold";
    if (outcome === "No Proposal Sent") {
      if (noProposalReason === "Not Within Scope") return "Not Within Scope";
      if (noProposalReason === "Did Not Meet Minimum") return "Did Not Meet Minimum";
      return "No Proposal Sent";
    }
    if (followUpResult === "Proposal Revision Requested") return "Proposal Revision Requested";
    if (followUpResult === "Waiting on Decision") return "Waiting on Decision";
    if (followUpResult === "Requested Callback") return "Requested Callback";
    return "Needs Follow-Up";
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const patch: LeadPatch = {
        status: "Completed",
        estimate_outcome: outcome,
        outcome_badge: deriveBadge(),
      };
      if (outcome === "No Proposal Sent") {
        patch.no_proposal_reason = noProposalReason;
        patch.no_proposal_notes = noProposalReason === "Other" ? noProposalNotes || null : null;
      }
      if (outcome === "Needs Follow-Up") {
        patch.follow_up_result = followUpResult;
        patch.follow_up_notes = followUpResult === "Other" ? followUpNotes || null : null;
      }
      await onSubmit(patch);
    } finally {
      setSubmitting(false);
    }
  }

  function selectPrimary(o: "Proposal Sent" | "No Proposal Sent") {
    if (o === "Proposal Sent") {
      setStep("proposal_result");
    } else {
      setOutcome("No Proposal Sent");
      setStep("no_proposal_reason");
    }
  }

  async function selectProposalResult(r: "Sold" | "Not Sold" | "Needs Follow-Up") {
    setOutcome(r);
    if (r === "Needs Follow-Up") {
      setStep("follow_up");
      return;
    }
    // Sold / Not Sold auto-submit
    setSubmitting(true);
    try {
      await onSubmit({
        status: "Completed",
        estimate_outcome: r,
        outcome_badge: r,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    (outcome === "Sold") ||
    (outcome === "Not Sold") ||
    (outcome === "No Proposal Sent" && noProposalReason && (noProposalReason !== "Other" || noProposalNotes.trim())) ||
    (outcome === "Needs Follow-Up" && followUpResult && (followUpResult !== "Other" || followUpNotes.trim()));

  const title =
    step === "primary" ? "Estimate Results" :
    step === "proposal_result" ? "Proposal Sent" :
    step === "no_proposal_reason" ? "No Proposal Sent" :
    "Follow-Up Details";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {leadName}
            </div>
            <div className="font-semibold text-[15px]">{title}</div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex items-center justify-center h-10 w-10 -mr-2 rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {step === "primary" && (
            <>
              <p className="text-sm text-[var(--muted)]">
                What was the result of this appointment?
              </p>
              <button
                onClick={() => selectPrimary("Proposal Sent")}
                className="flex items-center gap-3 w-full p-4 rounded-xl border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition text-left"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 text-green-600 shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold">Proposal Sent</div>
                  <div className="text-xs text-[var(--muted)]">An estimate was presented to the customer</div>
                </div>
              </button>
              <button
                onClick={() => selectPrimary("No Proposal Sent")}
                className="flex items-center gap-3 w-full p-4 rounded-xl border border-[var(--border)] hover:border-amber-400 hover:bg-amber-50 transition text-left"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 text-amber-600 shrink-0">
                  <FileX2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold">No Proposal Sent</div>
                  <div className="text-xs text-[var(--muted)]">No estimate was presented — select a reason</div>
                </div>
              </button>
            </>
          )}

          {step === "proposal_result" && (
            <>
              <p className="text-sm text-[var(--muted)]">
                What happened after the proposal?
              </p>
              <button
                onClick={() => selectProposalResult("Sold")}
                className="flex items-center gap-3 w-full p-4 rounded-xl border border-[var(--border)] hover:border-green-400 hover:bg-green-50 transition text-left"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 text-green-600 shrink-0">
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-green-700">Sold</div>
                  <div className="text-xs text-[var(--muted)]">Customer accepted the proposal</div>
                </div>
              </button>
              <button
                onClick={() => selectProposalResult("Not Sold")}
                className="flex items-center gap-3 w-full p-4 rounded-xl border border-[var(--border)] hover:border-rose-400 hover:bg-rose-50 transition text-left"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-rose-100 text-rose-600 shrink-0">
                  <XCircle className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-rose-700">Not Sold</div>
                  <div className="text-xs text-[var(--muted)]">Customer declined the proposal</div>
                </div>
              </button>
              <button
                onClick={() => selectProposalResult("Needs Follow-Up")}
                className="flex items-center gap-3 w-full p-4 rounded-xl border border-[var(--border)] hover:border-blue-400 hover:bg-blue-50 transition text-left"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 text-blue-600 shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-blue-700">Needs Follow-Up</div>
                  <div className="text-xs text-[var(--muted)]">Customer needs more time or information</div>
                </div>
              </button>
            </>
          )}

          {step === "no_proposal_reason" && (
            <>
              <p className="text-sm text-[var(--muted)]">
                Why wasn&apos;t a proposal sent?
              </p>
              <div className="space-y-2">
                {NO_PROPOSAL_REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setNoProposalReason(r)}
                    className={cn(
                      "flex items-center w-full px-4 py-3 rounded-xl border text-left text-sm font-medium transition",
                      noProposalReason === r
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--surface-2)]"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {noProposalReason === "Other" && (
                <textarea
                  value={noProposalNotes}
                  onChange={(e) => setNoProposalNotes(e.target.value)}
                  placeholder="Please describe the reason…"
                  rows={3}
                  className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] resize-none"
                  autoFocus
                />
              )}
            </>
          )}

          {step === "follow_up" && (
            <>
              <p className="text-sm text-[var(--muted)]">
                Log the follow-up result:
              </p>
              <div className="space-y-1.5">
                {FOLLOW_UP_RESULTS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setFollowUpResult(r)}
                    className={cn(
                      "flex items-center w-full px-4 py-2.5 rounded-xl border text-left text-sm font-medium transition",
                      followUpResult === r
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--surface-2)]"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {followUpResult === "Other" && (
                <textarea
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  placeholder="Describe the follow-up…"
                  rows={3}
                  className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] resize-none"
                  autoFocus
                />
              )}
            </>
          )}
        </div>

        {/* Footer — show submit button when we have enough data */}
        {step !== "primary" && (
          <div className="px-4 py-3 border-t border-[var(--border)] flex gap-2">
            <button
              onClick={() => {
                if (step === "proposal_result") setStep("primary");
                else if (step === "no_proposal_reason") setStep("primary");
                else if (step === "follow_up") setStep("proposal_result");
              }}
              className="flex-1 h-11 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-2)] transition"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className={cn(
                "flex-1 h-11 rounded-lg text-sm font-semibold text-white transition",
                canSubmit && !submitting
                  ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                  : "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed"
              )}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </span>
              ) : (
                "Complete Estimate"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
