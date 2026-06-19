"use client";

import { useState } from "react";
import { Loader2, Sparkles, AlertTriangle, ClipboardPaste } from "lucide-react";
import { cn } from "@/lib/utils";
import { StandaloneLeadCard } from "@/modules/leads";
import { useToast } from "@/components/Toast";
import type { Lead } from "@/modules/leads/model";
import type { DuplicateMatch } from "@/modules/leads";

type ApiOk = {
  result?: {
    lead_id?: string;
    intake_status?: string;
    lead?: Lead;
    duplicates?: DuplicateMatch[];
  };
};

type ApiErr = {
  error?: string;
  reason?: string;
  plan?: string;
  limit?: number;
};

export default function TextPasteBox({
  endpoint,
  onIngested,
}: {
  endpoint: string;
  onIngested?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [leads, setLeads] = useState<{ lead: Lead; duplicates?: DuplicateMatch[] }[]>([]);
  const [topError, setTopError] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setTopError(null);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });

      const bodyText = await res.text();
      let json: (ApiOk & ApiErr) | null = null;
      try {
        json = bodyText ? (JSON.parse(bodyText) as ApiOk & ApiErr) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json) {
        const msg =
          json?.error ||
          (res.status === 504
            ? "Request timed out — try shorter text or retry."
            : `Server error (${res.status})`);
        setTopError(msg);
        setBusy(false);
        return;
      }

      if (json.result?.lead) {
        setLeads((prev) => [
          { lead: json!.result!.lead!, duplicates: json!.result!.duplicates },
          ...prev,
        ]);
        setText("");
        toast({ kind: "success", message: "Lead extracted successfully" });
        onIngested?.();
      } else if (json.result?.lead_id) {
        toast({
          kind: "info",
          message: "Lead created but needs review — check your leads list.",
        });
        setText("");
        onIngested?.();
      }
    } catch (e) {
      setTopError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  function removeCard(id: string) {
    setLeads((prev) => prev.filter((l) => l.lead.id !== id));
  }

  return (
    <div className="space-y-4">
      {topError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{topError}</span>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border)] bg-white p-4 space-y-3">
        <label className="block text-sm font-medium text-[var(--fg)]">
          Paste a text message or lead notification
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"New Lead From Close-ai for Jane Doe\n\nName: Jane Doe\nNumber: (555) 123-4567\nAddress: 123 Main St, Springfield FL 32003\n\nClose-ai"}
          rows={6}
          disabled={busy}
          className={cn(
            "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--fg)] placeholder:text-[var(--muted)] resize-y",
            "focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]",
            "disabled:opacity-50"
          )}
        />
        <button
          onClick={handleSubmit}
          disabled={busy || !text.trim()}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl px-4 h-11 text-sm font-medium w-full transition active:scale-[0.98]",
            "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting lead...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Extract Lead
            </>
          )}
        </button>
      </div>

      {leads.length === 0 && !busy && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-8 text-center text-sm text-[var(--muted)]">
          <ClipboardPaste className="mx-auto mb-2 h-6 w-6 opacity-50" />
          Paste a text message, CRM notification, or any plain text with
          lead info. The AI will extract name, phone, address, and source
          — same as uploading a screenshot.
        </div>
      )}

      {leads.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {leads.map((l) => (
            <StandaloneLeadCard
              key={l.lead.id}
              initialLead={l.lead}
              onRemoved={removeCard}
              duplicates={l.duplicates}
            />
          ))}
        </div>
      )}
    </div>
  );
}
