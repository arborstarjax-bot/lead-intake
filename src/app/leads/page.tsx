"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import LeadTable from "@/components/LeadTable";
import EnableNotifications from "@/components/EnableNotifications";
import { cn } from "@/lib/utils";

export default function LeadsPage() {
  return (
    <Suspense fallback={<LeadsSkeleton />}>
      <LeadsPageInner />
    </Suspense>
  );
}

function LeadsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("view") === "completed" ? "completed" : "active";
  const [view, setView] = useState<"active" | "completed">(initial);
  const [counts, setCounts] = useState({ active: 0, completed: 0 });

  function switchView(next: "active" | "completed") {
    setView(next);
    const url = next === "active" ? "/leads" : "/leads?view=completed";
    router.replace(url, { scroll: false });
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">
          {view === "active" ? "View / Edit Leads" : "Completed Leads"}
        </h1>
        <EnableNotifications />
      </header>

      <div className="flex gap-2 border-b border-[var(--border)]">
        <TabButton active={view === "active"} onClick={() => switchView("active")}>
          View / Edit Leads
          <span className="ml-2 text-xs text-[var(--muted)]">{counts.active}</span>
        </TabButton>
        <TabButton
          active={view === "completed"}
          onClick={() => switchView("completed")}
        >
          Completed Leads
          <span className="ml-2 text-xs text-[var(--muted)]">{counts.completed}</span>
        </TabButton>
      </div>

      <LeadTable view={view} onCounts={setCounts} />
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
        active
          ? "border-[var(--accent)] text-[var(--fg)]"
          : "border-transparent text-[var(--muted)]"
      )}
    >
      {children}
    </button>
  );
}

function LeadsSkeleton() {
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
      <div className="mt-6 h-64 rounded-xl bg-gray-100 animate-pulse" />
    </main>
  );
}
