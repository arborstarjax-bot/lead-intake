"use client";

import { useRef, useState } from "react";
import { UploadCloud, Loader2, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { downscaleImage } from "@/lib/downscale";
import StandaloneLeadCard from "@/components/StandaloneLeadCard";
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

type ApiErr = { error?: string };

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
  const [failures, setFailures] = useState<{ fileName: string; message: string }[]>([]);
  const [topError, setTopError] = useState<string | null>(null);

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
        const fallback =
          res.status === 504
            ? "Upload timed out — the image took too long to process. Try again or use a smaller/cropped screenshot."
            : res.status === 413
            ? "Image is too large. Try taking a new screenshot or cropping before uploading."
            : res.status >= 500
            ? `Server error (${res.status}). Please try again.`
            : `Upload failed (${res.status || "network"}).`;
        setTopError(json?.error ?? fallback);
      } else {
        const newLeads = (json.results ?? [])
          .map((r) => r.lead)
          .filter((l): l is Lead => Boolean(l));
        setLeads((prev) => [...newLeads, ...prev]);
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

  const hasCards = leads.length > 0;

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

      {hasCards && (
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
    </div>
  );
}
