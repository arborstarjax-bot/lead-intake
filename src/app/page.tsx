"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Settings as SettingsIcon,
  UploadCloud,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import UploadBox from "@/components/UploadBox";
import StandaloneLeadCard from "@/components/StandaloneLeadCard";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

/**
 * Build a placeholder Lead that lives only in React state. The POST to
 * /api/leads doesn't fire until the user actually types something — see
 * StandaloneLeadCard's `pending` mode. That way tapping "Start a new
 * lead" and walking away never leaves a blank ghost row in the table.
 */
function buildPendingLead(): Lead {
  const now = new Date().toISOString();
  return {
    id: `pending-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    created_at: now,
    updated_at: now,
    date: null,
    first_name: null,
    last_name: null,
    client: null,
    phone_number: null,
    email: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    status: "New",
    sales_person: null,
    scheduled_day: null,
    scheduled_time: null,
    notes: null,
    screenshot_url: null,
    screenshot_path: null,
    extraction_confidence: null,
    calendar_event_id: null,
    calendar_scheduled_day: null,
    calendar_scheduled_time: null,
    intake_source: "manual",
    intake_status: "ready",
  };
}

type IntakeTab = "upload" | "manual";

export default function HomePage() {
  const [tab, setTab] = useState<IntakeTab>("upload");
  // Manual-entry cards live locally until the user types. `pendingIds`
  // tracks which are still un-persisted so we can tell StandaloneLeadCard
  // to POST (instead of PATCH) on the first keystroke.
  const [manualLeads, setManualLeads] = useState<Lead[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  function startManualLead() {
    const stub = buildPendingLead();
    setManualLeads((prev) => [stub, ...prev]);
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.add(stub.id);
      return next;
    });
  }

  function removeManualLead(id: string) {
    setManualLeads((prev) => prev.filter((l) => l.id !== id));
    setPendingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 space-y-6">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" aria-label="Home" className="inline-flex items-center">
          <Logo variant="full" size="lg" priority />
        </Link>

        <div className="flex items-center gap-2 text-xs sm:text-sm">
          <Link
            href="/workspace"
            aria-label="Workspace"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <Users className="h-4 w-4" />
          </Link>
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
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-xl px-4 h-11 text-sm font-medium w-full sm:w-auto transition active:scale-[0.98]",
                  "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                )}
              >
                <Plus className="h-4 w-4" />
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
                      pending={pendingIds.has(l.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

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
