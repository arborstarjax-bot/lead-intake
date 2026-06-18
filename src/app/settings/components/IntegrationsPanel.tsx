"use client";

import { useEffect, useState } from "react";
import { CalendarCheck2, CalendarX2, RefreshCw } from "lucide-react";
import EnableNotifications from "@/components/EnableNotifications";
import { Panel } from "./Panel";

interface IntegrationsPanelProps {
  autoSyncToSingleOps: boolean;
  onAutoSyncChange: (value: boolean) => void;
  canEdit: boolean;
}

export function IntegrationsPanel({
  autoSyncToSingleOps,
  onAutoSyncChange,
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
