"use client";

import { useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PendingFile = {
  name: string;
  state: "uploading" | "added" | "needs_review" | "error";
  message?: string;
  lead_id?: string;
};

type ApiOk = {
  results?: {
    fileName: string;
    originalFileName?: string;
    lead_id?: string;
    intake_status?: string;
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
  const [files, setFiles] = useState<PendingFile[]>([]);

  async function handleFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    if (picked.length === 0 || busy) return;
    setBusy(true);
    const initial: PendingFile[] = picked.map((f) => ({
      name: f.name,
      state: "uploading",
    }));
    setFiles(initial);
    const form = new FormData();
    picked.forEach((f) => form.append("file", f));
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
            : res.status >= 500
            ? `Server error (${res.status}). Please try again.`
            : `Upload failed (${res.status || "network"}).`;
        setFiles(
          initial.map((f) => ({
            ...f,
            state: "error",
            message: json?.error ?? fallback,
          }))
        );
      } else {
        const byName = new Map<string, PendingFile>();
        (json.results ?? []).forEach((r) => {
          // Server may have converted HEIC -> JPEG and renamed the file; key
          // status by the original client-side name so the row still matches.
          const key = r.originalFileName ?? r.fileName;
          byName.set(key, {
            name: key,
            lead_id: r.lead_id,
            state: r.intake_status === "needs_review" ? "needs_review" : "added",
          });
        });
        (json.errors ?? []).forEach((e) => {
          byName.set(e.fileName, {
            name: e.fileName,
            state: "error",
            message: e.error,
          });
        });
        setFiles(initial.map((f) => byName.get(f.name) ?? f));
        onUploaded?.();
      }
    } catch (e) {
      setFiles(
        initial.map((f) => ({
          ...f,
          state: "error",
          message: (e as Error).message,
        }))
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
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
          "relative w-full rounded-2xl border-2 border-dashed p-8 text-center transition",
          busy
            ? "cursor-not-allowed border-[var(--accent)] bg-blue-50/60"
            : dragging
            ? "cursor-pointer border-[var(--accent)] bg-blue-50"
            : "cursor-pointer border-[var(--border)] bg-white hover:bg-gray-50"
        )}
      >
        {busy ? (
          <Loader2 className="mx-auto h-10 w-10 text-[var(--accent)] animate-spin" />
        ) : (
          <UploadCloud className="mx-auto h-10 w-10 text-[var(--muted)]" />
        )}
        <div className="mt-3 font-medium">
          {busy
            ? `Uploading & extracting ${files.length} ${files.length === 1 ? "screenshot" : "screenshots"}…`
            : "Upload lead screenshot"}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {busy
            ? "Hang tight — GPT-4o is reading each image."
            : "Tap to choose from your phone, or drag & drop images here."}
        </p>
        {!busy && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            JPG, PNG, HEIC — one or many at once.
          </p>
        )}
        {busy && (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
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

      {files.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {files.map((f, i) => (
            <li
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 border",
                f.state === "uploading" && "border-[var(--border)] bg-gray-50 text-[var(--muted)]",
                f.state === "added" && "border-green-200 bg-green-50 text-green-900",
                f.state === "needs_review" && "border-amber-200 bg-amber-50 text-amber-900",
                f.state === "error" && "border-red-200 bg-red-50 text-red-900"
              )}
            >
              {f.state === "uploading" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              )}
              <span className="font-medium truncate">{f.name}</span>
              <span className="ml-auto text-xs shrink-0">
                {f.state === "uploading" && "processing…"}
                {f.state === "added" && "added"}
                {f.state === "needs_review" && "needs review"}
                {f.state === "error" && (f.message ?? "failed")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
