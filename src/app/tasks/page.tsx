"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Calendar, Clock, MapPin, User, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import {
  TASK_STATUS_COLORS,
  type Task,
  type TaskStatus,
} from "@/modules/tasks/model";
import { NewTaskModal } from "./NewTaskModal";

type FilterTab = "upcoming" | TaskStatus | "all";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "Scheduled", label: "Scheduled" },
  { key: "Completed", label: "Completed" },
  { key: "Rescheduled", label: "Rescheduled" },
  { key: "Cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay =
    s.toLocaleDateString() === e.toLocaleDateString();
  if (sameDay) {
    return `${s.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })} ${s.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })} - ${e.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("upcoming");
  const [showNewTask, setShowNewTask] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?status=all");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = tasks.filter((t) => {
    if (filter === "all") return true;
    if (filter === "upcoming") {
      return (
        t.status === "Scheduled" && new Date(t.start_at) >= new Date()
      );
    }
    return t.status === filter;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
  });

  async function deleteTask(id: string) {
    if (!confirm("Delete this task?")) return;
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function updateStatus(id: string, status: TaskStatus) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const data = await res.json();
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? data.task : t)),
      );
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 pt-4 pb-28">
      <PageHeader title="Tasks" />

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === tab.key
                  ? "bg-[var(--accent)] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowNewTask(true)}
          className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New Task
        </button>
      </div>

      {/* Task list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : sortedTasks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No tasks found</p>
          <p className="text-sm mt-2">
            Click &quot;New Task&quot; to create one
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedTasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-gray-900 truncate">
                      {task.name}
                    </h3>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        TASK_STATUS_COLORS[task.status as TaskStatus] ||
                        "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                  {task.notes && (
                    <p className="text-sm text-gray-500 line-clamp-2 mb-2">
                      {task.notes}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {formatTimeRange(task.start_at, task.end_at)}
                    </span>
                    {task.assignee && (
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {task.assignee}
                      </span>
                    )}
                    {task.address && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {[task.address, task.city, task.state]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {task.status === "Scheduled" && (
                    <button
                      onClick={() => updateStatus(task.id, "Completed")}
                      title="Mark complete"
                      className="rounded p-1.5 text-green-600 hover:bg-green-50"
                    >
                      <Calendar className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteTask(task.id)}
                    title="Delete"
                    className="rounded p-1.5 text-red-400 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={(task) => {
            setTasks((prev) => [...prev, task]);
            setShowNewTask(false);
          }}
        />
      )}
    </div>
  );
}
