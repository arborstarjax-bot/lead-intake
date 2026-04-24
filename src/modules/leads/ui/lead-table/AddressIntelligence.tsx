"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Check, X } from "lucide-react";
import type { Lead } from "@/modules/leads/model";
import { cn } from "@/lib/utils";

/**
 * Address intelligence strip. Two responsibilities:
 *
 *  1. When the lead has enough anchor data (street address OR zip) but
 *     is missing at least one of city/state/zip/address, offer a one-tap
 *     "Autofill" button that hits /api/leads/infer-address and surfaces
 *     a suggestion with a confidence %. The user explicitly accepts —
 *     we never silently overwrite fields they may have typed.
 *
 *  2. After autofill (or after an ingest that stamped confidence on
 *     address fields), render a row of "AI ##%" chips so the operator
 *     can see at a glance how much to trust each field.
 *
 * Decoupled from <InlineField> because (a) the confidence summary is
 * a single-per-lead UI concern, not per-field, and (b) the debounced
 * suggestion loop needs to watch the whole address group at once.
 */
const ADDRESS_FIELDS = ["address", "city", "state", "zip"] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];

type Match = {
  parts: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  formatted: string;
  confidence: number;
  locationType: string;
  partialMatch: boolean;
};

export function AddressIntelligence({
  lead,
  onPatch,
}: {
  lead: Lead;
  onPatch: (p: Partial<Lead>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Match | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Track the (address, city, state, zip) tuple we last suggested for so
  // a new edit clears the stale suggestion card.
  const lastSignature = useRef<string>("");

  const currentSignature = useMemo(
    () =>
      JSON.stringify({
        address: lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
      }),
    [lead.address, lead.city, lead.state, lead.zip]
  );

  useEffect(() => {
    if (currentSignature !== lastSignature.current) {
      setSuggestion(null);
      setError(null);
      setDismissed(false);
    }
  }, [currentSignature]);

  const missing: AddressField[] = [];
  if (!(lead.address ?? "").trim()) missing.push("address");
  if (!(lead.city ?? "").trim()) missing.push("city");
  if (!(lead.state ?? "").trim()) missing.push("state");
  if (!(lead.zip ?? "").trim()) missing.push("zip");

  const hasAnchor =
    Boolean((lead.address ?? "").trim()) || Boolean((lead.zip ?? "").trim());
  const filledCount = ADDRESS_FIELDS.length - missing.length;
  // Need an anchor (street or zip) AND at least one other field to make
  // a credible inference — a lone zip would just return the zip's
  // centroid, which isn't useful for the single-property workflow.
  const canAutofill = hasAnchor && filledCount >= 2 && missing.length > 0;

  // Surface any AI-inferred fields (confidence > 0) that still have a
  // value on the lead. Rendered as chips so the operator sees
  // reliability at a glance.
  //
  // Skip fields where `conf[f] === 0`: the AI extractor stamps 0 when
  // it couldn't find the field in the image at all (see
  // `ExtractedLead.confidence` in modules/ingest/server/ai/extract.ts,
  // whose system prompt says "A field that is absent from the image
  // should be null with confidence 0"). If the field later has a value
  // on the lead, the user typed it in manually — showing "AI city 0%"
  // for an operator-typed value is misleading. Only fields with a
  // positive AI score deserve an AI chip.
  const chips = useMemo(() => {
    const conf = lead.extraction_confidence ?? {};
    return ADDRESS_FIELDS.map((f) => {
      const raw = conf[f];
      const score = typeof raw === "number" && raw > 0 ? raw : null;
      const value = (lead[f] ?? "") as string;
      if (score == null || !value) return null;
      return { field: f, score, value };
    }).filter(Boolean) as { field: AddressField; score: number; value: string }[];
  }, [lead]);

  async function runInference() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/infer-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: lead.address,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Inference failed (${res.status})`);
        setSuggestion(null);
        return;
      }
      lastSignature.current = currentSignature;
      if (!json.match) {
        setError(json.reason ?? "No confident match found.");
        setSuggestion(null);
        return;
      }
      setSuggestion(json.match as Match);
      setDismissed(false);
    } catch (e) {
      setError((e as Error).message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  function applySuggestion() {
    if (!suggestion) return;
    // Only fill blanks — never clobber a field the user already typed.
    // This matches the user's mental model: "infer MISSING fields".
    const patch: Partial<Lead> = {};
    const confMerge: Record<string, number> = {};
    for (const f of ADDRESS_FIELDS) {
      const existing = (lead[f] ?? "").trim();
      const inferred = suggestion.parts[f];
      if (!existing && inferred) {
        (patch as Record<string, unknown>)[f] = inferred;
        confMerge[f] = suggestion.confidence;
      }
    }
    if (Object.keys(patch).length === 0) {
      setSuggestion(null);
      return;
    }
    // `extraction_confidence_merge` is a server-side merge (see
    // /api/leads/[id]/route.ts) so we don't have to round-trip the full
    // extraction_confidence blob.
    (patch as unknown as Record<string, unknown>).extraction_confidence_merge =
      confMerge;
    onPatch(patch);
    setSuggestion(null);
  }

  const showChips = chips.length > 0;
  const showSuggestion = suggestion && !dismissed;
  const showAutofillButton = canAutofill && !showSuggestion;

  if (!showChips && !showAutofillButton && !error) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {showChips && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--muted)]">
            AI
          </span>
          {chips.map((c) => (
            <span
              key={c.field}
              title={`${c.field} inferred with ${Math.round(c.score * 100)}% confidence`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 h-5 text-[10px] font-medium border",
                c.score >= 0.85
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : c.score >= 0.6
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
              )}
            >
              <Sparkles className="h-3 w-3" />
              {c.field} {Math.round(c.score * 100)}%
            </span>
          ))}
        </div>
      )}

      {showAutofillButton && (
        <button
          type="button"
          onClick={runInference}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)] px-3 h-8 text-xs font-medium hover:bg-[var(--accent)]/15 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Autofill {missing.join(" & ")}
        </button>
      )}

      {showSuggestion && suggestion && (
        <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              AI suggestion · {Math.round(suggestion.confidence * 100)}%
              {suggestion.partialMatch && (
                <span className="ml-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-[1px] text-[10px] font-medium">
                  partial
                </span>
              )}
            </div>
          </div>
          <div className="text-sm text-[var(--fg)]">{suggestion.formatted}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
            {ADDRESS_FIELDS.map((f) => {
              const existing = (lead[f] ?? "").trim();
              const inferred = suggestion.parts[f];
              if (!inferred) return null;
              const willFill = !existing && inferred;
              return (
                <div key={f} className="contents">
                  <dt className="capitalize">{f}</dt>
                  <dd
                    className={cn(
                      "truncate",
                      willFill ? "text-[var(--fg)] font-medium" : "line-through text-[var(--subtle)]"
                    )}
                    title={willFill ? "Will fill this blank field" : "You already entered a value — won't overwrite"}
                  >
                    {inferred}
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={applySuggestion}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] text-white px-3 h-8 text-xs font-semibold hover:bg-[var(--accent-hover)]"
            >
              <Check className="h-3.5 w-3.5" />
              Accept
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 h-8 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]"
            >
              <X className="h-3.5 w-3.5" />
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && !showSuggestion && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {error}
        </div>
      )}
    </div>
  );
}
