"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LeadTable,
  type LeadFilter,
  type FollowUpSubFilter,
  type LeadCounts,
  type OutcomeReasonSubFilter,
  FOLLOW_UP_RESULTS,
  OUTCOME_REASONS,
} from "@/modules/leads";
import NotificationAcknowledge from "@/components/NotificationAcknowledge";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

const TABS: { id: LeadFilter; label: string }[] = [
  { id: "New", label: "New" },
  { id: "Called / No Response", label: "Needs Follow-Up" },
  { id: "Scheduled", label: "Scheduled" },
  { id: "Pending", label: "Pending" },
  { id: "Sold", label: "Sold" },
  { id: "Not Sold", label: "Not Sold" },
  { id: "Lost", label: "Lost" },
  { id: "All", label: "All" },
];

const SUB_FILTER_OPTIONS: { id: FollowUpSubFilter; label: string }[] = [
  { id: "All", label: "All" },
  { id: "No Contact Yet", label: "Called — No Answer" },
  ...FOLLOW_UP_RESULTS.filter((r) => r !== "Called — No Answer").map((r) => ({ id: r as FollowUpSubFilter, label: r })),
];

const OUTCOME_SUB_FILTER_OPTIONS: { id: OutcomeReasonSubFilter; label: string }[] = [
  { id: "All", label: "All" },
  ...OUTCOME_REASONS.map((r) => ({ id: r as OutcomeReasonSubFilter, label: r })),
];

const LOST_SUB_FILTER_OPTIONS: { id: OutcomeReasonSubFilter; label: string }[] = [
  ...OUTCOME_SUB_FILTER_OPTIONS,
  { id: "Expired", label: "Expired" },
];

const EMPTY_COUNTS: LeadCounts = {
  All: 0,
  New: 0,
  "Called / No Response": 0,
  Scheduled: 0,
  Pending: 0,
  Completed: 0,
  Lost: 0,
  Sold: 0,
  "Not Sold": 0,
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
    case "Pending":
      return "pending";
    case "Completed":
      return "completed";
    case "Lost":
      return "lost";
    case "Sold":
      return "sold";
    case "Not Sold":
      return "not-sold";
  }
}

function LeadsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = filterFromParam(params.get("status"));
  const [filter, setFilter] = useState<LeadFilter>(initial);
  const [subFilter, setSubFilter] = useState<FollowUpSubFilter>("All");
  const [outcomeSubFilter, setOutcomeSubFilter] = useState<OutcomeReasonSubFilter>("All");
  const [counts, setCounts] = useState<LeadCounts>(EMPTY_COUNTS);

  function switchFilter(next: LeadFilter) {
    setFilter(next);
    setSubFilter("All");
    setOutcomeSubFilter("All");
    const q = paramFor(next);
    router.replace(q === "new" ? "/leads" : `/leads?status=${q}`, { scroll: false });
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      <NotificationAcknowledge />
      <PageHeader title="Leads" />

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

      {filter === "Called / No Response" && (
        <div className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar">
          <div className="inline-flex min-w-full gap-1.5 px-4 sm:px-0">
            {SUB_FILTER_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => setSubFilter(o.id)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors border",
                  subFilter === o.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)]"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(filter === "Lost" || filter === "Not Sold") && (
        <div className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar">
          <div className="inline-flex min-w-full gap-1.5 px-4 sm:px-0">
            {(filter === "Lost" ? LOST_SUB_FILTER_OPTIONS : OUTCOME_SUB_FILTER_OPTIONS).map((o) => (
              <button
                key={o.id}
                onClick={() => setOutcomeSubFilter(o.id)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors border",
                  outcomeSubFilter === o.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)]"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <LeadTable
        filter={filter}
        subFilter={filter === "Called / No Response" ? subFilter : undefined}
        outcomeSubFilter={(filter === "Lost" || filter === "Not Sold") ? outcomeSubFilter : undefined}
        onCounts={setCounts}
      />
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
