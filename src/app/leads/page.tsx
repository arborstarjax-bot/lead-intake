"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import LeadTable, { type LeadFilter, type LeadCounts } from "@/components/LeadTable";
import NotificationAcknowledge from "@/components/NotificationAcknowledge";
import { cn } from "@/lib/utils";

const TABS: { id: LeadFilter; label: string }[] = [
  { id: "New", label: "New" },
  { id: "Called / No Response", label: "Needs Followup" },
  { id: "Scheduled", label: "Scheduled" },
  { id: "Completed", label: "Completed" },
  { id: "Lost", label: "Lost" },
  { id: "All", label: "All" },
];

const EMPTY_COUNTS: LeadCounts = {
  All: 0,
  New: 0,
  "Called / No Response": 0,
  Scheduled: 0,
  Completed: 0,
  Lost: 0,
};

export default function LeadsPage() {
  return (
    <Suspense fallback={<LeadsSkeleton />}>
      <LeadsPageInner />
    </Suspense>
  );
}

function filterFromParam(p: string | null): LeadFilter {
  const match = TABS.find((t) => paramFor(t.id) === p);
  return match ? match.id : "New";
}

function paramFor(id: LeadFilter): string {
  switch (id) {
    case "All":
      return "all";
    case "New":
      return "new";
    case "Called / No Response":
      return "called";
    case "Scheduled":
      return "scheduled";
    case "Completed":
      return "completed";
    case "Lost":
      return "lost";
  }
}

function LeadsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = filterFromParam(params.get("status"));
  const [filter, setFilter] = useState<LeadFilter>(initial);
  const [counts, setCounts] = useState<LeadCounts>(EMPTY_COUNTS);

  function switchFilter(next: LeadFilter) {
    setFilter(next);
    const q = paramFor(next);
    router.replace(q === "new" ? "/leads" : `/leads?status=${q}`, { scroll: false });
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <NotificationAcknowledge />
      <header className="flex items-center justify-between gap-3">
        <Link href="/" aria-label="Home" className="inline-flex items-center">
          <Logo variant="mark" size="sm" />
        </Link>
        <h1 className="text-lg sm:text-xl font-semibold">Leads</h1>
        <div className="w-9" />
      </header>

      <nav
        aria-label="Lead status"
        className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar border-b border-[var(--border)]"
      >
        <div className="inline-flex min-w-full gap-1 px-4 sm:px-0">
          {TABS.map((t) => (
            <TabButton
              key={t.id}
              active={filter === t.id}
              onClick={() => switchFilter(t.id)}
            >
              {t.label}
              <CountBadge n={counts[t.id] ?? 0} active={filter === t.id} />
            </TabButton>
          ))}
        </div>
      </nav>

      <LeadTable filter={filter} onCounts={setCounts} />
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
        "inline-flex items-center gap-1.5 whitespace-nowrap px-3 sm:px-4 h-11 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-[var(--accent)] text-[var(--fg)]"
          : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
      )}
    >
      {children}
    </button>
  );
}

function CountBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-[11px] font-semibold",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "bg-[var(--surface-2)] text-[var(--muted)]"
      )}
    >
      {n}
    </span>
  );
}

function LeadsSkeleton() {
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="h-6 w-40 rounded bg-gray-100 animate-pulse" />
      <div className="mt-6 h-64 rounded-2xl bg-gray-100 animate-pulse" />
    </main>
  );
}
