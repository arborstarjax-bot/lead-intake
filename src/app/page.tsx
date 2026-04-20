"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList } from "lucide-react";
import UploadBox from "@/components/UploadBox";
import InstallButton from "@/components/InstallButton";

export default function HomePage() {
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<{ active: number; completed: number } | null>(null);

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
        </div>
      </header>

      <section className="space-y-3">
        <UploadBox endpoint="/api/ingest" />
        <InstallButton />
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
      </nav>
    </main>
  );
}
