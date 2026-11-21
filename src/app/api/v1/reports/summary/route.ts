import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { resolveApiAuth, requireScope, ok, serverError } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compact funnel summary — the numbers a CRM dashboard wants. */
export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "reports:read");
  if (scopeErr) return scopeErr;

  const days = Math.min(parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10) || 30, 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: leads, error } = await createAdminClient()
    .from("leads")
    .select("status, estimate_outcome, created_at")
    .eq("workspace_id", auth.workspaceId)
    .gte("created_at", since);
  if (error) return serverError(error.message);

  const all = leads ?? [];
  const estimatesSent = all.filter((l) => l.estimate_outcome || l.status === "Pending").length;
  const sold = all.filter((l) => l.estimate_outcome === "Sold").length;
  const notSold = all.filter((l) => l.estimate_outcome === "Not Sold").length;

  return ok({
    windowDays: days,
    totalLeads: all.length,
    estimatesSent,
    estimatesAccepted: sold,
    estimatesDeclined: notSold,
    closeRate: estimatesSent ? Math.round((sold / estimatesSent) * 100) : 0,
  });
}
