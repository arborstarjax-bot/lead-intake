"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import type {
  ReportData,
  SourceRow,
  PipelineStage,
  SalespersonRow,
} from "@/app/api/reports/route";

type TimeRange = "all" | "today" | "week" | "month";

const TIME_TABS: { id: TimeRange; label: string }[] = [
  { id: "all", label: "All Time" },
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
];

const PIPELINE_COLORS: Record<string, string> = {
  New: "bg-blue-500",
  "Needs Follow-Up": "bg-amber-500",
  Scheduled: "bg-indigo-500",
  Pending: "bg-purple-500",
  Sold: "bg-emerald-500",
  "Not Sold": "bg-red-400",
  Lost: "bg-gray-400",
};

function pct(n: number): string {
  return `${n}%`;
}

/* ── Skeleton / empty states ──────────────────────────────────── */

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-4 animate-pulse">
      <div className="h-3 w-20 bg-gray-200 rounded mb-3" />
      <div className="h-7 w-16 bg-gray-200 rounded" />
    </div>
  );
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 bg-gray-100 rounded" />
      ))}
    </div>
  );
}

/* ── Summary Card ─────────────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-4 flex flex-col gap-1",
        accent
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/20"
          : "border-[var(--border)]"
      )}
    >
      <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums">
        {value}
        {suffix ? (
          <span className="text-base font-medium text-[var(--muted)]">
            {suffix}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* ── Source Breakdown Table ────────────────────────────────────── */

function SourceTable({ rows }: { rows: SourceRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)] py-6 text-center">
        No lead source data yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            <th className="py-2 px-4">Source</th>
            <th className="py-2 px-4 text-right">Leads</th>
            <th className="py-2 px-4 text-right">Proposals</th>
            <th className="py-2 px-4 text-right">Accepted</th>
            <th className="py-2 px-4 text-right">Accept %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.source}
              className="border-b border-[var(--border)] last:border-0 hover:bg-gray-50/50"
            >
              <td className="py-2.5 px-4 font-medium">{r.source}</td>
              <td className="py-2.5 px-4 text-right tabular-nums">
                {r.leads}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums">
                {r.proposalsSent}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums">
                {r.accepted}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums font-medium">
                {pct(r.acceptanceRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Pipeline Funnel ──────────────────────────────────────────── */

function PipelineFunnel({
  stages,
  total,
}: {
  stages: PipelineStage[];
  total: number;
}) {
  if (total === 0) {
    return (
      <p className="text-sm text-[var(--muted)] py-6 text-center">
        No pipeline data yet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {stages.map((s) => (
        <div key={s.stage} className="flex items-center gap-3">
          <span className="w-28 sm:w-36 text-sm font-medium text-right shrink-0 truncate">
            {s.stage}
          </span>
          <div className="flex-1 h-7 bg-gray-100 rounded-lg overflow-hidden relative">
            <div
              className={cn(
                "h-full rounded-lg transition-all duration-500",
                PIPELINE_COLORS[s.stage] ?? "bg-gray-400"
              )}
              style={{ width: `${Math.max(s.pct, 2)}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
              {s.count} ({pct(s.pct)})
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Salesperson Table ────────────────────────────────────────── */

function SalespersonTable({ rows }: { rows: SalespersonRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)] py-6 text-center">
        No salesperson data yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            <th className="py-2 px-4">Salesperson</th>
            <th className="py-2 px-4 text-right">Leads</th>
            <th className="py-2 px-4 text-right">Proposals</th>
            <th className="py-2 px-4 text-right">Sold</th>
            <th className="py-2 px-4 text-right">Close %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.name}
              className="border-b border-[var(--border)] last:border-0 hover:bg-gray-50/50"
            >
              <td className="py-2.5 px-4 font-medium">{r.name}</td>
              <td className="py-2.5 px-4 text-right tabular-nums">
                {r.leadsAssigned}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums">
                {r.proposalsSent}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums">
                {r.sold}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums font-medium">
                {pct(r.closeRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */

export default function ReportingPage() {
  const [range, setRange] = useState<TimeRange>("all");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async (r: TimeRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports?range=${r}`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(range);
  }, [range, fetchReport]);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 space-y-6 pb-24">
      <PageHeader title="Reporting" />

      {/* Time range tabs */}
      <div
        role="tablist"
        aria-label="Time range"
        className="flex gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1.5 overflow-x-auto"
      >
        {TIME_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={range === t.id}
            onClick={() => setRange(t.id)}
            className={cn(
              "flex-1 min-w-[5rem] rounded-lg px-3 py-2 text-sm font-medium transition whitespace-nowrap",
              range === t.id
                ? "bg-white shadow-sm text-[var(--fg)]"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {loading || !data ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard label="Total Leads" value={data.totalLeads} />
          <SummaryCard label="Proposals Sent" value={data.proposalsSent} />
          <SummaryCard
            label="Proposals Accepted"
            value={data.proposalsAccepted}
          />
          <SummaryCard
            label="Conversion Rate"
            value={data.conversionRate}
            suffix="%"
            accent
          />
          <SummaryCard
            label="Close Rate"
            value={data.closeRate}
            suffix="%"
            accent
          />
        </div>
      )}

      {/* Lead Source Breakdown */}
      <section className="rounded-xl border border-[var(--border)] bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold mb-4">
          Lead Source Breakdown
        </h2>
        {loading || !data ? (
          <TableSkeleton />
        ) : (
          <SourceTable rows={data.sourceBreakdown} />
        )}
      </section>

      {/* Sales Pipeline */}
      <section className="rounded-xl border border-[var(--border)] bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold mb-4">Sales Pipeline</h2>
        {loading || !data ? (
          <TableSkeleton rows={7} />
        ) : (
          <PipelineFunnel stages={data.pipeline} total={data.totalLeads} />
        )}
      </section>

      {/* Salesperson Performance */}
      <section className="rounded-xl border border-[var(--border)] bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold mb-4">
          Salesperson Performance
        </h2>
        {loading || !data ? (
          <TableSkeleton />
        ) : (
          <SalespersonTable rows={data.salespersonStats} />
        )}
      </section>
    </main>
  );
}
