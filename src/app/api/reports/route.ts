import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

type TimeRange = "all" | "today" | "week" | "month";

function rangeStart(range: TimeRange): string | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "today") {
    now.setHours(0, 0, 0, 0);
  } else if (range === "week") {
    const day = now.getDay();
    now.setDate(now.getDate() - day);
    now.setHours(0, 0, 0, 0);
  } else if (range === "month") {
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
  }
  return now.toISOString();
}

export type ReportData = {
  totalLeads: number;
  proposalsSent: number;
  proposalsAccepted: number;
  proposalsNotSold: number;
  conversionRate: number;
  closeRate: number;
  sourceBreakdown: SourceRow[];
  pipeline: PipelineStage[];
  salespersonStats: SalespersonRow[];
};

export type SourceRow = {
  source: string;
  leads: number;
  proposalsSent: number;
  accepted: number;
  acceptanceRate: number;
};

export type PipelineStage = {
  stage: string;
  count: number;
  pct: number;
};

export type SalespersonRow = {
  name: string;
  leadsAssigned: number;
  proposalsSent: number;
  sold: number;
  closeRate: number;
};

export async function GET(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const range = (req.nextUrl.searchParams.get("range") ?? "all") as TimeRange;
  const start = rangeStart(range);

  const supabase = createAdminClient();

  let query = supabase
    .from("leads")
    .select("id, status, lead_source, estimate_outcome, outcome_badge, sales_person, follow_up_result, created_at")
    .eq("workspace_id", auth.workspaceId);

  if (start) {
    query = query.gte("created_at", start);
  }

  const { data: leads, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const all = leads ?? [];
  const totalLeads = all.length;

  // Proposals sent = leads that have an estimate_outcome set (they got a proposal)
  // OR are in Pending status (proposal sent, waiting)
  const proposalsSent = all.filter(
    (l) =>
      l.estimate_outcome !== null ||
      l.status === "Pending" ||
      l.outcome_badge === "Sold" ||
      l.outcome_badge === "Not Sold"
  ).length;

  const proposalsAccepted = all.filter(
    (l) => l.outcome_badge === "Sold" || l.estimate_outcome === "Sold"
  ).length;

  const proposalsNotSold = all.filter(
    (l) => l.outcome_badge === "Not Sold" || l.estimate_outcome === "Not Sold"
  ).length;

  const conversionRate =
    totalLeads > 0 ? Math.round((proposalsSent / totalLeads) * 100) : 0;
  const closeRate =
    proposalsSent > 0
      ? Math.round((proposalsAccepted / proposalsSent) * 100)
      : 0;

  // ── Lead Source Breakdown ──
  const sourceMap = new Map<
    string,
    { leads: number; proposals: number; accepted: number }
  >();
  for (const l of all) {
    const src = l.lead_source ?? "Unknown";
    const entry = sourceMap.get(src) ?? { leads: 0, proposals: 0, accepted: 0 };
    entry.leads++;
    if (
      l.estimate_outcome !== null ||
      l.status === "Pending" ||
      l.outcome_badge === "Sold" ||
      l.outcome_badge === "Not Sold"
    ) {
      entry.proposals++;
    }
    if (l.outcome_badge === "Sold" || l.estimate_outcome === "Sold") {
      entry.accepted++;
    }
    sourceMap.set(src, entry);
  }

  const sourceBreakdown: SourceRow[] = [...sourceMap.entries()]
    .map(([source, s]) => ({
      source,
      leads: s.leads,
      proposalsSent: s.proposals,
      accepted: s.accepted,
      acceptanceRate:
        s.proposals > 0 ? Math.round((s.accepted / s.proposals) * 100) : 0,
    }))
    .sort((a, b) => b.leads - a.leads);

  // ── Pipeline ──
  const stages: { stage: string; filter: (l: (typeof all)[0]) => boolean }[] = [
    { stage: "New", filter: (l) => l.status === "New" },
    {
      stage: "Needs Follow-Up",
      filter: (l) => l.status === "Called / No Response",
    },
    { stage: "Scheduled", filter: (l) => l.status === "Scheduled" },
    { stage: "Pending", filter: (l) => l.status === "Pending" },
    {
      stage: "Sold",
      filter: (l) =>
        l.outcome_badge === "Sold" || l.estimate_outcome === "Sold",
    },
    {
      stage: "Not Sold",
      filter: (l) =>
        l.outcome_badge === "Not Sold" || l.estimate_outcome === "Not Sold",
    },
    { stage: "Lost", filter: (l) => l.status === "Lost" },
  ];
  const pipeline: PipelineStage[] = stages.map((s) => {
    const count = all.filter(s.filter).length;
    return {
      stage: s.stage,
      count,
      pct: totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0,
    };
  });

  // ── Salesperson Stats ──
  const spMap = new Map<
    string,
    { leads: number; proposals: number; sold: number }
  >();
  for (const l of all) {
    const sp = l.sales_person ?? "Unassigned";
    const entry = spMap.get(sp) ?? { leads: 0, proposals: 0, sold: 0 };
    entry.leads++;
    if (
      l.estimate_outcome !== null ||
      l.status === "Pending" ||
      l.outcome_badge === "Sold" ||
      l.outcome_badge === "Not Sold"
    ) {
      entry.proposals++;
    }
    if (l.outcome_badge === "Sold" || l.estimate_outcome === "Sold") {
      entry.sold++;
    }
    spMap.set(sp, entry);
  }

  const salespersonStats: SalespersonRow[] = [...spMap.entries()]
    .map(([name, s]) => ({
      name,
      leadsAssigned: s.leads,
      proposalsSent: s.proposals,
      sold: s.sold,
      closeRate:
        s.proposals > 0 ? Math.round((s.sold / s.proposals) * 100) : 0,
    }))
    .sort((a, b) => b.leadsAssigned - a.leadsAssigned);

  const report: ReportData = {
    totalLeads,
    proposalsSent,
    proposalsAccepted,
    proposalsNotSold,
    conversionRate,
    closeRate,
    sourceBreakdown,
    pipeline,
    salespersonStats,
  };

  return NextResponse.json(report);
}
