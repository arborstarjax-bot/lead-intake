"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  RefreshCw,
  Trash2,
  User,
} from "lucide-react";
import type { Task, TaskPatch } from "@/modules/tasks/model";
import {
  TASK_STATUS_COLORS,
  TASK_STATUSES,
  RECURRENCE_OPTIONS,
  type TaskStatus,
} from "@/modules/tasks/model";
import { AddressInput, type AddressParts } from "@/components/AddressInput";

function toLocalDatetimeStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaskDetailCard({ initialTask }: { initialTask: Task }) {
  const router = useRouter();
  const [task, setTask] = useState<Task>(initialTask);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pushing, setPushing] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<TaskPatch>({});

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

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? null : f)), 2500);
  }, []);

  const saveNow = useCallback(async (patch: TaskPatch) => {
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setTask(data.task);
      } else {
        showFlash("Save failed");
      }
    } catch {
      showFlash("Network error");
    } finally {
      setSaving(false);
    }
  }, [task.id, showFlash]);

  const scheduleSave = useCallback((patch: TaskPatch) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const pending = pendingRef.current;
      pendingRef.current = {};
      saveNow(pending);
    }, 600);
  }, [saveNow]);

  const flushSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const pending = pendingRef.current;
    if (Object.keys(pending).length > 0) {
      pendingRef.current = {};
      saveNow(pending);
    }
  }, [saveNow]);

  // Flush on unmount
  useEffect(() => {
    return () => flushSave();
  }, [flushSave]);

  function handleFieldChange(field: keyof TaskPatch, value: string | null) {
    setTask((prev) => ({ ...prev, [field]: value }));
    scheduleSave({ [field]: value });
  }

  function handleAddressSelect(parts: AddressParts) {
    setTask((prev) => ({
      ...prev,
      address: parts.street,
      city: parts.city,
      state: parts.state,
      zip: parts.zip,
    }));
    saveNow({
      address: parts.street,
      city: parts.city,
      state: parts.state,
      zip: parts.zip,
    });
  }

  async function handleStatusChange(status: TaskStatus) {
    setTask((prev) => ({ ...prev, status }));
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const data = await res.json();
        setTask(data.task);
        showFlash(`Status: ${status}`);
      }
    } catch {
      showFlash("Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  async function handlePushToSingleOps() {
    if (!task.singleops_task_id) {
      showFlash("No SingleOps task linked");
      return;
    }
    setPushing(true);
    try {
      const start = new Date(task.start_at);
      const scheduledDate = start.toISOString().split("T")[0];
      const scheduledTime = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
      const res = await fetch("/api/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push-task",
          taskId: task.id,
          singleopsTaskId: task.singleops_task_id,
          clientName: task.name,
          scheduledDate,
          scheduledTime,
        }),
      });
      if (res.ok) {
        showFlash("Pushed to SingleOps");
      } else {
        const data = await res.json().catch(() => ({}));
        showFlash(data.error || "Push failed");
      }
    } catch {
      showFlash("Network error");
    } finally {
      setPushing(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this task?")) return;
    setDeleting(true);
    try {
      await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      router.push("/tasks");
    } catch {
      showFlash("Failed to delete");
      setDeleting(false);
    }
  }

  const addressDisplay = [task.address, task.city, task.state, task.zip]
    .filter(Boolean)
    .join(", ");

  const inputClass =
    "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white shadow-sm overflow-hidden">
      {/* Header with status + actions */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              TASK_STATUS_COLORS[task.status as TaskStatus] || "bg-gray-100 text-gray-800"
            }`}
          >
            {task.status}
          </span>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted)]" />}
        </div>
        <div className="flex items-center gap-1">
          {task.status === "Scheduled" && (
            <button
              onClick={() => handleStatusChange("Completed")}
              className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Complete
            </button>
          )}
          {task.status === "Completed" && (
            <button
              onClick={() => handleStatusChange("Scheduled")}
              className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reopen
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {/* Name */}
        <div className="px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] mb-1">
            Task Name
          </label>
          <input
            type="text"
            value={task.name}
            onChange={(e) => handleFieldChange("name", e.target.value)}
            onBlur={flushSave}
            placeholder="Task name"
            className={inputClass + " font-medium"}
          />
        </div>

        {/* Notes */}
        <div className="px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] mb-1">
            Notes
          </label>
          <textarea
            value={task.notes ?? ""}
            onChange={(e) => handleFieldChange("notes", e.target.value || null)}
            onBlur={flushSave}
            placeholder="Add notes..."
            rows={3}
            className={inputClass}
          />
        </div>

        {/* Start / End */}
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] mb-1">
              <Clock className="h-3.5 w-3.5" />
              Start
            </label>
            <input
              type="datetime-local"
              value={toLocalDatetimeStr(new Date(task.start_at))}
              onChange={(e) => {
                const val = e.target.value;
                if (val) handleFieldChange("start_at", new Date(val).toISOString());
              }}
              onBlur={flushSave}
              className={inputClass}
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] mb-1">
              <Calendar className="h-3.5 w-3.5" />
              End
            </label>
            <input
              type="datetime-local"
              value={toLocalDatetimeStr(new Date(task.end_at))}
              onChange={(e) => {
                const val = e.target.value;
                if (val) handleFieldChange("end_at", new Date(val).toISOString());
              }}
              onBlur={flushSave}
              className={inputClass}
            />
          </div>
        </div>

        {/* Assignee */}
        <div className="px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] mb-1">
            <User className="h-3.5 w-3.5" />
            Assignee
          </label>
          {salespeople.length > 0 ? (
            <select
              value={task.assignee ?? ""}
              onChange={(e) => handleFieldChange("assignee", e.target.value || null)}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {salespeople.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={task.assignee ?? ""}
              onChange={(e) => handleFieldChange("assignee", e.target.value || null)}
              onBlur={flushSave}
              placeholder="Assignee"
              className={inputClass}
            />
          )}
        </div>

        {/* Address */}
        <div className="px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] mb-1">
            <MapPin className="h-3.5 w-3.5" />
            Address
          </label>
          <AddressInput
            value={task.address ?? ""}
            onChange={(val) => handleFieldChange("address", val || null)}
            onSelect={handleAddressSelect}
            placeholder="123 Main St"
            className={inputClass}
          />
          {addressDisplay && (
            <p className="text-xs text-[var(--muted)] mt-1">{addressDisplay}</p>
          )}
        </div>

        {/* Recurrence */}
        <div className="px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] mb-1">
            <RefreshCw className="h-3.5 w-3.5" />
            Recurrence
          </label>
          <select
            value={task.recurrence_rule ?? ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setTask((prev) => ({ ...prev, recurrence_rule: val }));
              saveNow({ recurrence_rule: val });
            }}
            className={inputClass}
          >
            {RECURRENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Status selector */}
        <div className="px-4 py-3">
          <label className="text-xs font-medium text-[var(--muted)] mb-1 block">
            Status
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TASK_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  task.status === s
                    ? TASK_STATUS_COLORS[s]
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Sync info + manual push */}
        {task.singleops_task_id && (
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-[var(--muted)]">
              SingleOps Task #{task.singleops_task_id}
              {task.singleops_last_synced_at && (
                <> &middot; Last synced {new Date(task.singleops_last_synced_at).toLocaleString()}</>
              )}
            </span>
            <button
              onClick={handlePushToSingleOps}
              disabled={pushing}
              className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {pushing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
              Push to SingleOps
            </button>
          </div>
        )}
      </div>

      {/* Flash message */}
      {flash && (
        <div className="px-4 py-2 bg-amber-50 text-amber-800 text-xs text-center">
          {flash}
        </div>
      )}
    </div>
  );
}
