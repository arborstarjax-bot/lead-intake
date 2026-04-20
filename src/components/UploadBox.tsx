"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

type UploadResult = {
  fileName: string;
  lead_id?: string;
  intake_status?: string;
  error?: string;
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
  const [results, setResults] = useState<UploadResult[]>([]);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setResults([]);
    const form = new FormData();
    list.forEach((f) => form.append("file", f));
    try {
      const res = await fetch(endpoint, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setResults([{ fileName: "(request)", error: json.error ?? "Upload failed" }]);
      } else {
        const merged: UploadResult[] = [
          ...(json.results ?? []),
          ...(json.errors ?? []).map((e: { fileName: string; error: string }) => ({
            fileName: e.fileName,
            error: e.error,
          })),
        ];
        setResults(merged);
        onUploaded?.();
      }
    } catch (e) {
      setResults([{ fileName: "(request)", error: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "w-full rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition",
          dragging
            ? "border-[var(--accent)] bg-blue-50"
            : "border-[var(--border)] bg-white hover:bg-gray-50"
        )}
      >
        <UploadCloud className="mx-auto h-10 w-10 text-[var(--muted)]" />
        <div className="mt-3 font-medium">
          {busy ? "Uploading & extracting…" : "Upload lead screenshot"}
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Tap to choose from your phone, or drag & drop images here.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          JPG, PNG, HEIC — one or many at once.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {results.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((r, i) => (
            <li
              key={i}
              className={cn(
                "rounded-md px-3 py-2 border",
                r.error
                  ? "border-red-200 bg-red-50 text-red-900"
                  : r.intake_status === "needs_review"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-green-200 bg-green-50 text-green-900"
              )}
            >
              <span className="font-medium">{r.fileName}</span>{" "}
              {r.error
                ? `— ${r.error}`
                : r.intake_status === "needs_review"
                ? "— needs review"
                : "— added"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
