"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { UploadCloud, Loader2, Plus, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { downscaleImage } from "@/lib/downscale";
import StandaloneLeadCard from "@/components/StandaloneLeadCard";
import { useToast } from "@/components/Toast";
import type { Lead } from "@/lib/types";

type ApiOk = {
  results?: {
    fileName: string;
    originalFileName?: string;
    lead_id?: string;
    intake_status?: string;
    lead?: Lead;
  }[];
  errors?: { fileName: string; error: string }[];
};

type ApiErr = {
  error?: string;
  reason?: string;
  plan?: string;
  limit?: number;
};

export default function UploadBox({
  endpoint,
  onUploaded,
}: {
  endpoint: string;
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [orphans, setOrphans] = useState<
    { lead_id: string; fileName: string; intake_status?: string }[]
  >([]);
  const [failures, setFailures] = useState<{ fileName: string; message: string }[]>([]);
  const [topError, setTopError] = useState<string | null>(null);
  const [capHit, setCapHit] = useState<{ plan: string; limit: number } | null>(
    null
  );
  const [subRequired, setSubRequired] = useState<{
    plan: string;
    message: string;
  } | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const { toast } = useToast();

  async function upgradeToPro() {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      });
      const data: { url?: string; error?: string; detail?: string } = await res
        .json()
        .catch(() => ({ error: "bad response" }));
      if (!res.ok || !data.url) {
        throw new Error(data.detail || data.error || `http ${res.status}`);
      }
      window.location.href = data.url;
    } catch (err) {
      setUpgrading(false);
      toast({
        kind: "error",
        message:
          err instanceof Error
            ? `Could not start upgrade: ${err.message}`
            : "Could not start upgrade",
      });
    }
  }

  async function handleFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setBusyCount(picked.length);
    setTopError(null);
    // Downscale large screenshots before upload so we stay under Vercel's
    // 4.5 MB request body limit. GPT-4o only needs the visible text, so
    // shrinking to ~1600px edge is lossless in practice.
    const prepared = await Promise.all(picked.map((f) => downscaleImage(f)));
    const form = new FormData();
    prepared.forEach((f, i) => form.append("file", f, picked[i].name));
    try {
      const res = await fetch(endpoint, { method: "POST", body: form });
      // Vercel returns an HTML error page on timeout/crash (504/502). Parsing
      // that as JSON throws a cryptic Safari error ("The string did not match
      // the expected pattern"). Read as text first and only parse if it
      // actually looks like JSON so users see an actionable message.
      const bodyText = await res.text();
      let json: (ApiOk & ApiErr) | null = null;
      try {
        json = bodyText ? (JSON.parse(bodyText) as ApiOk & ApiErr) : null;
      } catch {
        json = null;
      }
      if (!res.ok || !json) {
        // Daily Starter cap — show an upsell modal instead of an error
        // banner. Users hit this mid-workflow; the friction has to buy
        // them a 1-click upgrade, not a dead end.
        if (res.status === 429 && json?.reason === "plan_cap") {
          setCapHit({
            plan: json.plan ?? "starter",
            limit: json.limit ?? 50,
          });
        } else if (
          res.status === 402 &&
          json?.reason === "subscription_required"
        ) {
          // Trial ended, card failed (past_due), or subscription canceled.
          // Send the user to /billing with a dedicated modal rather than a
          // generic error banner — the recovery action is always the same.
          setSubRequired({
            plan: json.plan ?? "free",
            message:
              json.error ??
              "Your subscription has lapsed. Update your billing to keep uploading.",
          });
        } else {
          const fallback =
            res.status === 504
              ? "Upload timed out — the image took too long to process. Try again or use a smaller/cropped screenshot."
              : res.status === 413
              ? "Image is too large. Try taking a new screenshot or cropping before uploading."
              : res.status >= 500
              ? `Server error (${res.status}). Please try again.`
              : `Upload failed (${res.status || "network"}).`;
          setTopError(json?.error ?? fallback);
        }
      } else {
        const results = json.results ?? [];
        const withLead: Lead[] = [];
        const withoutLead: {
          lead_id: string;
          fileName: string;
          intake_status?: string;
        }[] = [];
        for (const r of results) {
          if (r.lead) withLead.push(r.lead);
          else if (r.lead_id)
            withoutLead.push({
              lead_id: r.lead_id,
              fileName: r.originalFileName ?? r.fileName,
              intake_status: r.intake_status,
            });
        }
        // Backfill: the server attaches full lead objects via a best-effort
        // secondary query. If that query failed (transient DB error), every
        // `r.lead` would be undefined even though the leads were created
        // successfully. Fetch the full list and match by id so we still
        // render cards instead of silently dropping the uploads.
        if (withoutLead.length > 0) {
          try {
            const listRes = await fetch("/api/leads?view=all");
            const listJson = await listRes.json();
            const byId = new Map<string, Lead>(
              (Array.isArray(listJson.leads) ? listJson.leads : []).map(
                (l: Lead) => [l.id, l]
              )
            );
            const recovered: typeof withoutLead = [];
            for (const orphan of withoutLead) {
              const match = byId.get(orphan.lead_id);
              if (match) withLead.push(match);
              else recovered.push(orphan);
            }
            withoutLead.length = 0;
            withoutLead.push(...recovered);
          } catch {
            // Ignore — we'll fall through to the status-row fallback.
          }
        }
        setLeads((prev) => [...withLead, ...prev]);
        if (withoutLead.length > 0) {
          setOrphans((prev) => [...withoutLead, ...prev]);
        }
        setFailures((prev) => [
          ...(json.errors ?? []).map((e) => ({
            fileName: e.fileName,
            message: e.error,
          })),
          ...prev,
        ]);
        onUploaded?.();
      }
    } catch (e) {
      setTopError((e as Error).message || "Upload failed");
    } finally {
      setBusy(false);
      setBusyCount(0);
    }
  }

  function removeLead(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
  }

  const hasCards = leads.length > 0 || orphans.length > 0;

  return (
    <div className="space-y-4">
      {/* Dropzone. Shrinks to a compact "Upload more" strip once we have
          cards to show, so the screenshot + card stack stays the focal
          point rather than the empty uploader. */}
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        aria-busy={busy}
        className={cn(
          "relative w-full rounded-2xl border-2 border-dashed text-center transition",
          hasCards ? "p-4" : "p-8",
          busy
            ? "cursor-not-allowed border-[var(--accent)] bg-blue-50/60"
            : dragging
            ? "cursor-pointer border-[var(--accent)] bg-blue-50"
            : "cursor-pointer border-[var(--border)] bg-white hover:bg-gray-50"
        )}
      >
        {busy ? (
          <Loader2
            className={cn(
              "mx-auto text-[var(--accent)] animate-spin",
              hasCards ? "h-6 w-6" : "h-10 w-10"
            )}
          />
        ) : hasCards ? (
          <Plus className="mx-auto h-5 w-5 text-[var(--muted)]" />
        ) : (
          <UploadCloud className="mx-auto h-10 w-10 text-[var(--muted)]" />
        )}
        <div className={cn("font-medium", hasCards ? "mt-1.5 text-sm" : "mt-3")}>
          {busy
            ? `Uploading & extracting ${busyCount} ${busyCount === 1 ? "screenshot" : "screenshots"}…`
            : hasCards
            ? "Upload another screenshot"
            : "Upload lead screenshot"}
        </div>
        {!hasCards && (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {busy
              ? "Hang tight — GPT-4o is reading each image."
              : "Tap to choose from your phone, or drag & drop images here."}
          </p>
        )}
        {!busy && !hasCards && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            JPG, PNG, HEIC — one or many at once.
          </p>
        )}
        {busy && (
          <div className={cn("w-full overflow-hidden rounded-full bg-white/60", hasCards ? "mt-2 h-1" : "mt-4 h-1.5")}>
            <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-[var(--accent)]" />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          disabled={busy}
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {topError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{topError}</span>
        </div>
      )}

      {failures.length > 0 && (
        <ul className="space-y-1 text-sm">
          {failures.map((f, i) => (
            <li
              key={`err-${i}`}
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="font-medium truncate">{f.fileName}</span>
              <span className="ml-auto text-xs shrink-0">{f.message}</span>
            </li>
          ))}
        </ul>
      )}

      {orphans.length > 0 && (
        <ul className="space-y-1 text-sm">
          {orphans.map((o) => (
            <li
              key={`orphan-${o.lead_id}`}
              className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              <span className="font-medium truncate">{o.fileName}</span>
              <span className="ml-auto text-xs shrink-0 text-[var(--muted)]">
                {o.intake_status === "needs_review" ? "needs review" : "added"}
              </span>
              <Link
                href="/leads"
                className="text-xs shrink-0 text-[var(--accent)] underline underline-offset-2"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}

      {leads.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {leads.map((l) => (
            <StandaloneLeadCard
              key={l.id}
              initialLead={l}
              onRemoved={removeLead}
            />
          ))}
        </div>
      )}

      {capHit && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="upgrade-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !upgrading && setCapHit(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-[var(--accent-soft)] p-2">
                <Sparkles className="h-5 w-5 text-[var(--accent)]" />
              </div>
              <div className="space-y-1">
                <h3
                  id="upgrade-dialog-title"
                  className="font-semibold text-base"
                >
                  Daily upload limit reached
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  You&apos;ve used all {capHit.limit} Starter uploads for today.
                  Upgrade to Pro for unlimited uploads and keep going.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">Pro</span>
                <span className="font-semibold">$59.99/mo</span>
              </div>
              <div className="text-xs text-[var(--muted)]">
                Unlimited uploads · Unlimited team members
              </div>
              <div className="text-xs text-[var(--muted)] mt-1">
                Prorated: you&apos;ll only be charged the difference
                (~$30/mo) for the remaining days in this cycle.
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={upgrading}
                onClick={() => setCapHit(null)}
                className="px-4 h-10 rounded-lg border border-[var(--border)] bg-white text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Not now
              </button>
              <button
                type="button"
                disabled={upgrading}
                onClick={upgradeToPro}
                className="px-4 h-10 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 inline-flex items-center gap-2"
              >
                {upgrading && <Loader2 className="h-4 w-4 animate-spin" />}
                Upgrade to Pro
              </button>
            </div>
          </div>
        </div>
      )}

      {subRequired && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sub-required-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSubRequired(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-red-50 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div className="space-y-1">
                <h3
                  id="sub-required-dialog-title"
                  className="font-semibold text-base"
                >
                  Subscription required
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  {subRequired.message}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setSubRequired(null)}
                className="px-4 h-10 rounded-lg border border-[var(--border)] bg-white text-sm font-medium hover:bg-gray-50"
              >
                Close
              </button>
              <Link
                href="/billing"
                className="px-4 h-10 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] inline-flex items-center"
              >
                Go to billing
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
