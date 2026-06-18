"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, CalendarX2, RefreshCw, History } from "lucide-react";
import EnableNotifications from "@/components/EnableNotifications";
import { Panel } from "./Panel";

interface AuditLogEntry {
  id: string;
  entity_type: "lead" | "task";
  entity_name: string | null;
  action: string;
  direction: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface IntegrationsPanelProps {
  autoSyncToSingleOps: boolean;
  onAutoSyncChange: (value: boolean) => void;
  syncIntervalMinutes: number;
  onSyncIntervalChange: (value: number) => void;
  canEdit: boolean;
}

export function IntegrationsPanel({
  autoSyncToSingleOps,
  onAutoSyncChange,
  syncIntervalMinutes,
  onSyncIntervalChange,
  canEdit,
}: IntegrationsPanelProps) {
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((j) => setGoogleConnected(Boolean(j.connected)))
      .catch(() => setGoogleConnected(false));
  }, []);

  return (
    <>
    <Panel
      title="Integrations"
      description="Calendar sync and push notifications are per-user. Each workspace member enables them once on their own device."
    >
      <Row
        title="Google Calendar"
        subtitle={
          googleConnected === null
            ? "Checking status…"
            : googleConnected
              ? "Connected. Bookings sync to your primary calendar."
              : "Not connected. Connect so booked estimates sync to your calendar."
        }
        right={
          googleConnected ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400 bg-emerald-50 text-emerald-700 px-3 h-9 text-xs font-medium">
              <CalendarCheck2 className="h-4 w-4" />
              Connected
            </span>
          ) : (
            <a
              href="/api/google/connect"
              className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-emerald-50 px-3 h-9 text-xs font-medium"
            >
              <CalendarX2 className="h-4 w-4" />
              Connect
            </a>
          )
        }
      />
      <Row
        title="Push notifications"
        subtitle="Get pinged when a new lead lands. Requires Add-to-Home-Screen on iPhone."
        right={<EnableNotifications />}
      />
      <Row
        title="Auto-sync to SingleOps"
        subtitle="When you reschedule a lead in Lead Flow, automatically update the task in SingleOps."
        right={
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => onAutoSyncChange(!autoSyncToSingleOps)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoSyncToSingleOps ? "bg-emerald-600" : "bg-gray-300"
            } ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                autoSyncToSingleOps ? "translate-x-6" : "translate-x-1"
              }`}
            />
            <RefreshCw className="sr-only" />
          </button>
        }
      />
      <Row
        title="Sync interval"
        subtitle="How often ArborBridge checks SingleOps for changes."
        right={
          <select
            disabled={!canEdit}
            value={syncIntervalMinutes}
            onChange={(e) => onSyncIntervalChange(parseInt(e.target.value))}
            className={`rounded-md border border-gray-300 bg-white px-2 py-1 text-sm ${
              !canEdit ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
          </select>
        }
      />
    </Panel>

    <SyncHistory />
    </>
  );
}

function SyncHistory() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchLogs = useCallback(() => {
    setLoading(true);
    fetch("/api/sync-audit?limit=50")
      .then((r) => r.json())
      .then((d) => setLogs(Array.isArray(d.logs) ? d.logs : []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (expanded) fetchLogs();
  }, [expanded, fetchLogs]);

  const directionLabel = (d: string) => {
    if (d === "leadflow_to_singleops") return "→ SingleOps";
    if (d === "singleops_to_leadflow") return "← SingleOps";
    return "Internal";
  };

  const actionLabel = (a: string) => {
    const map: Record<string, string> = {
      created: "Created",
      updated: "Updated",
      completed: "Completed",
      rescheduled: "Rescheduled",
      cancelled: "Cancelled",
      synced_to_singleops: "Synced →",
      synced_from_singleops: "Synced ←",
      sync_failed: "Failed",
    };
    return map[a] || a;
  };

  const statusColor = (s: string) => {
    if (s === "success") return "text-emerald-600";
    if (s === "failed") return "text-red-600";
    return "text-yellow-600";
  };

  return (
    <Panel
      title="Sync History"
      description="Recent sync activity between Lead Flow and SingleOps."
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-[var(--accent)] hover:underline"
      >
        <History className="h-4 w-4" />
        {expanded ? "Hide sync log" : "Show sync log"}
      </button>

      {expanded && (
        <div className="mt-3 space-y-1">
          {loading && (
            <div className="text-xs text-[var(--muted)]">Loading…</div>
          )}
          {!loading && logs.length === 0 && (
            <div className="text-xs text-[var(--muted)]">No sync activity recorded yet.</div>
          )}
          {!loading && logs.length > 0 && (
            <div className="max-h-80 overflow-y-auto border border-[var(--border)] rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white border-b border-[var(--border)]">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium text-[var(--muted)]">Time</th>
                    <th className="text-left px-2 py-1.5 font-medium text-[var(--muted)]">Type</th>
                    <th className="text-left px-2 py-1.5 font-medium text-[var(--muted)]">Name</th>
                    <th className="text-left px-2 py-1.5 font-medium text-[var(--muted)]">Action</th>
                    <th className="text-left px-2 py-1.5 font-medium text-[var(--muted)]">Direction</th>
                    <th className="text-left px-2 py-1.5 font-medium text-[var(--muted)]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--surface-2)]/50">
                      <td className="px-2 py-1 text-[var(--muted)] whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-2 py-1 capitalize">{log.entity_type}</td>
                      <td className="px-2 py-1 truncate max-w-[120px]" title={log.entity_name ?? ""}>
                        {log.entity_name || "—"}
                      </td>
                      <td className="px-2 py-1">{actionLabel(log.action)}</td>
                      <td className="px-2 py-1 text-[var(--muted)]">{directionLabel(log.direction)}</td>
                      <td className={`px-2 py-1 font-medium ${statusColor(log.status)}`}>
                        {log.status === "success" ? "OK" : log.status}
                        {log.error_message && (
                          <span className="ml-1 text-red-500" title={log.error_message}>⚠</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {expanded && !loading && (
            <button
              type="button"
              onClick={fetchLogs}
              className="text-xs text-[var(--accent)] hover:underline mt-1"
            >
              Refresh
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

function Row({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">{subtitle}</div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}
