"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardList,
  Map as MapIcon,
  Settings as SettingsIcon,
  UploadCloud,
  Pencil,
  Plus,
  Loader2,
} from "lucide-react";
import UploadBox from "@/components/UploadBox";
import StandaloneLeadCard from "@/components/StandaloneLeadCard";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

type IntakeTab = "upload" | "manual";

export default function HomePage() {
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<{ active: number; completed: number } | null>(null);
  const [tab, setTab] = useState<IntakeTab>("upload");
  const [manualLeads, setManualLeads] = useState<Lead[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((j) => setGoogleConnected(Boolean(j.connected)))
      .catch(() => setGoogleConnected(false));
    Promise.all([
      fetch("/api/leads?view=active").then((r) => r.json()),
      fetch("/api/leads?view=completed").then((r) => r.json()),
    ])
      .then(([a, c]) =>
        setCounts({
          active: Array.isArray(a.leads) ? a.leads.length : 0,
          completed: Array.isArray(c.leads) ? c.leads.length : 0,
        })
      )
      .catch(() => setCounts({ active: 0, completed: 0 }));
  }, []);

  async function startManualLead() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (res.ok && json.lead) {
        setManualLeads((prev) => [json.lead as Lead, ...prev]);
      } else {
        alert(json.error ?? "Could not create lead");
      }
    } finally {
      setCreating(false);
    }
  }

  function removeManualLead(id: string) {
    setManualLeads((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-semibold">Lead Intake</h1>
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          {googleConnected === false && (
            <a
              href="/api/google/connect"
              className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5"
            >
              Connect Google Calendar
            </a>
          )}
          {googleConnected && (
            <span className="rounded-md border border-green-200 bg-green-50 text-green-800 px-3 py-1.5">
              Calendar connected
            </span>
          )}
          <Link
            href="/settings"
            aria-label="Settings"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section>
        <div
          role="tablist"
          aria-label="Intake method"
          className="grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1.5"
        >
          <TabButton
            active={tab === "upload"}
            onClick={() => setTab("upload")}
            icon={<UploadCloud className="h-4 w-4" />}
            label="Upload Screenshot"
          />
          <TabButton
            active={tab === "manual"}
            onClick={() => setTab("manual")}
            icon={<Pencil className="h-4 w-4" />}
            label="Manual Entry"
          />
        </div>

        <div className="mt-4">
          {tab === "upload" ? (
            <UploadBox endpoint="/api/ingest" />
          ) : (
            <div className="space-y-4">
              <button
                onClick={startManualLead}
                disabled={creating}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 h-11 text-sm font-medium w-full sm:w-auto transition active:scale-[0.98]",
                  creating
                    ? "bg-[var(--surface-2)] text-[var(--subtle)] cursor-not-allowed"
                    : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                )}
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {manualLeads.length === 0 ? "Start a new lead" : "Add another lead"}
              </button>

              {manualLeads.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-8 text-center text-sm text-[var(--muted)]">
                  Type in a lead&apos;s info by hand. A new card will open
                  with every field editable — same as the View / Edit page.
                  Each card saves automatically as you type.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {manualLeads.map((l) => (
                    <StandaloneLeadCard
                      key={l.id}
                      initialLead={l}
                      onRemoved={removeManualLead}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <nav className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/leads"
          className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white p-4 hover:bg-gray-50 active:bg-gray-100 transition"
        >
          <span className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-[var(--accent)]" />
            <span className="font-medium">View / Edit Leads</span>
          </span>
          <span className="text-sm text-[var(--muted)]">{counts?.active ?? "—"}</span>
        </Link>
        <Link
          href="/leads?view=completed"
          className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white p-4 hover:bg-gray-50 active:bg-gray-100 transition"
        >
          <span className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span className="font-medium">Completed Leads</span>
          </span>
          <span className="text-sm text-[var(--muted)]">{counts?.completed ?? "—"}</span>
        </Link>
        <Link
          href="/route"
          className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white p-4 hover:bg-gray-50 active:bg-gray-100 transition sm:col-span-2"
        >
          <span className="flex items-center gap-3">
            <MapIcon className="h-5 w-5 text-[var(--accent)]" />
            <span className="font-medium">Route Map</span>
          </span>
          <span className="text-xs text-[var(--muted)]">Today + 14 days</span>
        </Link>
      </nav>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 h-10 text-sm font-medium transition",
        active
          ? "bg-white text-[var(--fg)] shadow-sm border border-[var(--border)]"
          : "text-[var(--muted)] hover:text-[var(--fg)]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
