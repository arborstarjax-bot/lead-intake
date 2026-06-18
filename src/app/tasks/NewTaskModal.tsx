"use client";

import { useEffect, useRef, useState } from "react";
import { X, UploadCloud, Loader2, Sparkles } from "lucide-react";
import type { Task } from "@/modules/tasks/model";
import { AddressInput, type AddressParts } from "@/components/AddressInput";
import { downscaleImage } from "@/lib/downscale";

interface NewTaskModalProps {
  onClose: () => void;
  onCreated: (task: Task) => void;
  initialStart?: string;
  initialEnd?: string;
}

type CreationMode = "manual" | "upload";

function toLocalDatetimeStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildDatetime(dateStr: string | null, timeStr: string | null, fallback: string): string {
  if (!dateStr) return fallback;
  if (timeStr) {
    return `${dateStr}T${timeStr}`;
  }
  return `${dateStr}T09:00`;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

export function NewTaskModal({
  onClose,
  onCreated,
  initialStart,
  initialEnd,
}: NewTaskModalProps) {
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

  const [mode, setMode] = useState<CreationMode>("manual");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [startAt, setStartAt] = useState(
    initialStart || toLocalDatetimeStr(now),
  );
  const [endAt, setEndAt] = useState(
    initialEnd || toLocalDatetimeStr(oneHourLater),
  );
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Workspace salespeople for assignee dropdown
  const [salespeople, setSalespeople] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.settings?.salespeople)) {
          setSalespeople(d.settings.salespeople);
        }
      })
      .catch(() => {});
  }, []);

  // Upload & Extract state
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleAddressSelect(parts: AddressParts) {
    setAddress(parts.street);
    setCity(parts.city);
    setState(parts.state);
    setZip(parts.zip);
  }

  async function handleExtract(file: File) {
    setExtracting(true);
    setError("");
    try {
      const prepared = await downscaleImage(file);
      const form = new FormData();
      form.append("file", prepared, file.name);
      const res = await fetch("/api/tasks/ingest", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Extraction failed");
        return;
      }
      const ex = data.extracted;
      if (ex.name) setName(ex.name);
      if (ex.notes) setNotes(ex.notes);
      if (ex.start_date || ex.start_time) {
        setStartAt(buildDatetime(ex.start_date, ex.start_time, startAt));
      }
      if (ex.end_date || ex.end_time) {
        const fallbackEnd = toLocalDatetimeStr(
          new Date(new Date(startAt).getTime() + 60 * 60 * 1000),
        );
        setEndAt(buildDatetime(ex.end_date, ex.end_time, fallbackEnd));
      }
      if (ex.address) setAddress(ex.address);
      if (ex.city) setCity(ex.city);
      if (ex.state) setState(ex.state);
      if (ex.zip) setZip(ex.zip);
      if (ex.assignee) setAssignee(ex.assignee);
      setExtracted(true);
      setMode("manual");
    } catch {
      setError("Network error during extraction");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Task name is required");
      return;
    }
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          notes: notes.trim() || null,
          start_at: new Date(startAt).toISOString(),
          end_at: new Date(endAt).toISOString(),
          address: address.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          zip: zip.trim() || null,
          assignee: assignee.trim() || null,
          extraction_source: extracted ? "upload_extract" : "manual",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create task");
        return;
      }
      onCreated(data.task);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">New Task</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex border-b">
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mode === "manual"
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Manual Entry
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mode === "upload"
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Upload &amp; Extract
          </button>
        </div>

        {mode === "upload" && !extracted ? (
          <div className="p-6">
            {error && (
              <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600 mb-4">
                {error}
              </p>
            )}
            {extracted && (
              <div className="flex items-center gap-2 rounded bg-green-50 px-3 py-2 text-sm text-green-700 mb-4">
                <Sparkles className="h-4 w-4" />
                Fields extracted! Review and adjust below.
              </div>
            )}
            {extracting ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
                <p className="text-sm text-gray-500">
                  AI is extracting task details...
                </p>
              </div>
            ) : (
              <div
                className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-8 cursor-pointer hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <UploadCloud className="h-10 w-10 text-gray-400" />
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">
                    Upload a document to extract task details
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    PDFs, images, screenshots, work orders
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf,.heic,.heif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleExtract(f);
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 p-5">
            {error && (
              <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            {extracted && (
              <div className="flex items-center gap-2 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
                <Sparkles className="h-4 w-4" />
                AI-extracted — review and adjust before creating.
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Site inspection, Follow-up call"
                className={inputClass}
                autoFocus
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Task details and purpose..."
                rows={3}
                className={inputClass}
              />
            </div>

            {/* Start */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start
              </label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => {
                  setStartAt(e.target.value);
                  const s = new Date(e.target.value);
                  const end = new Date(s.getTime() + 60 * 60 * 1000);
                  setEndAt(toLocalDatetimeStr(end));
                }}
                className={inputClass}
              />
            </div>

            {/* End */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End
              </label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Assignee */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assignee
              </label>
              {salespeople.length > 0 ? (
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select assignee...</option>
                  {salespeople.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Name of person assigned"
                  className={inputClass}
                />
              )}
            </div>

            {/* Address with autocomplete */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address
              </label>
              <AddressInput
                value={address}
                onChange={setAddress}
                onSelect={handleAddressSelect}
                placeholder="Start typing an address..."
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Zip
                </label>
                <input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Task"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
