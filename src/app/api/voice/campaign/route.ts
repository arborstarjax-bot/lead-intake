import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

/**
 * GET /api/voice/campaign — Get current/latest campaign status for workspace
 * POST /api/voice/campaign — Start a new campaign
 */

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();

  // Get the most recent active or recently completed campaign
  const { data: campaign } = await supabase
    .from("ai_campaigns")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ campaign: campaign ?? null });
}

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const filter = body.filter as string;
  if (filter !== "new" && filter !== "needs_follow_up") {
    return NextResponse.json(
      { error: "filter must be 'new' or 'needs_follow_up'" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Check no active campaign already running
  const { data: existing } = await supabase
    .from("ai_campaigns")
    .select("id, status")
    .eq("workspace_id", auth.workspaceId)
    .in("status", ["running", "paused"])
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "A campaign is already active", campaign_id: existing.id },
      { status: 409 }
    );
  }

  // Get leads matching the filter
  const statusFilter = filter === "new" ? "New" : "Called / No Response";
  const { data: leads } = await supabase
    .from("leads")
    .select("id, first_name, last_name, client, phone_number, ai_do_not_call")
    .eq("workspace_id", auth.workspaceId)
    .eq("status", statusFilter)
    .order("created_at", { ascending: true });

  // Filter out leads without phone numbers or on DNC
  const callableLeads = (leads ?? []).filter(
    (l) => l.phone_number && !l.ai_do_not_call
  );

  if (callableLeads.length === 0) {
    return NextResponse.json(
      { error: "No callable leads found" },
      { status: 404 }
    );
  }

  const leadQueue = callableLeads.map((l) => l.id);

  // Create the campaign
  const { data: campaign, error } = await supabase
    .from("ai_campaigns")
    .insert({
      workspace_id: auth.workspaceId,
      status: "running",
      filter,
      total_leads: leadQueue.length,
      completed_leads: 0,
      current_lead_id: leadQueue[0],
      lead_queue: leadQueue,
      results: [],
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Trigger the first call
  const firstLeadId = leadQueue[0];
  const triggerRes = await fetch(
    new URL("/api/voice/trigger", req.url).toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ lead_id: firstLeadId, manual: true }),
    }
  );

  if (!triggerRes.ok) {
    const err = await triggerRes.json().catch(() => ({}));
    // Mark first lead as failed and advance
    await supabase
      .from("ai_campaigns")
      .update({
        results: [{ lead_id: firstLeadId, name: getLeadName(callableLeads, firstLeadId), outcome: "failed", summary: err.error ?? "Trigger failed" }],
        completed_leads: 1,
        current_lead_id: leadQueue[1] ?? null,
        status: leadQueue.length <= 1 ? "completed" : "running",
      })
      .eq("id", campaign.id);
  }

  return NextResponse.json({ campaign });
}

function getLeadName(leads: Array<{ id: string; first_name: string | null; last_name: string | null; client: string | null }>, id: string): string {
  const lead = leads.find((l) => l.id === id);
  if (!lead) return "Unknown";
  return lead.client ?? ([lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Lead");
}
