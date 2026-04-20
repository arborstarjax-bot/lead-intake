"use client";

import { useEffect, useState } from "react";
import UploadBox from "@/components/UploadBox";
import InstallButton from "@/components/InstallButton";
import LeadTable from "@/components/LeadTable";
import { cn } from "@/lib/utils";
import { Link2 } from "lucide-react";

export default function HomePage() {
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [counts, setCounts] = useState({ active: 0, completed: 0 });
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [uploadToken, setUploadToken] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((j) => setGoogleConnected(Boolean(j.connected)))
      .catch(() => setGoogleConnected(false));
    fetch("/api/quick-link")
      .then((r) => r.json())
      .then((j) => setUploadToken(j.token ?? null))
      .catch(() => {});
  }, []);

  const quickUrl =
    typeof window !== "undefined" && uploadToken
      ? `${window.location.origin}/u/${uploadToken}`
      : null;

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 space-y-6">
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
        <UploadBox endpoint="/api/ingest" onUploaded={() => setTab("active")} />
        <InstallButton />
        {quickUrl && (
          <div className="rounded-xl border border-[var(--border)] bg-white p-4 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <Link2 className="h-4 w-4" /> Boss quick-upload link
            </div>
            <p className="text-sm text-[var(--muted)]">
              Text this to your boss. He opens it on his iPhone, taps to pick
              photos from his library or share sheet, and they ingest straight
              into this table — no login required.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={quickUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md border border-[var(--border)] bg-gray-50 px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(quickUrl);
                }}
                className="rounded-md bg-[var(--fg)] text-white px-3 py-1.5 text-sm"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="flex gap-2 border-b border-[var(--border)]">
          <TabButton active={tab === "active"} onClick={() => setTab("active")}>
            View / Edit Leads
            <span className="ml-2 text-xs text-[var(--muted)]">{counts.active}</span>
          </TabButton>
          <TabButton active={tab === "completed"} onClick={() => setTab("completed")}>
            Completed Leads
            <span className="ml-2 text-xs text-[var(--muted)]">{counts.completed}</span>
          </TabButton>
        </div>

        <div className="mt-4">
          <LeadTable view={tab} onCounts={setCounts} />
        </div>
      </section>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
        active ? "border-[var(--accent)] text-[var(--fg)]" : "border-transparent text-[var(--muted)]"
      )}
    >
      {children}
    </button>
  );
}
