import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

/**
 * POST /api/voice/campaign/control
 * Actions: pause, resume, stop
 */
export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const action = body.action as string;
  if (!["pause", "resume", "stop"].includes(action)) {
    return NextResponse.json(
      { error: "action must be 'pause', 'resume', or 'stop'" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Find active campaign
  const { data: campaign } = await supabase
    .from("ai_campaigns")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .in("status", ["running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json(
      { error: "No active campaign found" },
      { status: 404 }
    );
  }

  if (action === "pause") {
    if (campaign.status !== "running") {
      return NextResponse.json({ error: "Campaign is not running" }, { status: 400 });
    }
    await supabase
      .from("ai_campaigns")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
    return NextResponse.json({ status: "paused" });
  }

  if (action === "resume") {
    if (campaign.status !== "paused") {
      return NextResponse.json({ error: "Campaign is not paused" }, { status: 400 });
    }
    await supabase
      .from("ai_campaigns")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", campaign.id);

    // Trigger the next call if there's one pending
    const queue = campaign.lead_queue as string[];
    const completedCount = campaign.completed_leads as number;
    if (completedCount < queue.length) {
      const nextLeadId = queue[completedCount];
      await fetch(new URL("/api/voice/trigger", req.url).toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: req.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({ lead_id: nextLeadId, manual: true }),
      });
      await supabase
        .from("ai_campaigns")
        .update({ current_lead_id: nextLeadId })
        .eq("id", campaign.id);
    }

    return NextResponse.json({ status: "running" });
  }

  if (action === "stop") {
    await supabase
      .from("ai_campaigns")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
    return NextResponse.json({ status: "cancelled" });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
