import { NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/voice/active — Returns the current active AI call (if any)
 * Used by the ActiveCallBar component to show call-in-progress status.
 */
export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();

  // Find any active call (queued, ringing, or in_progress) from last 10 min
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: call } = await supabase
    .from("ai_calls")
    .select("id, lead_id, status, to_number, created_at, listen_url")
    .eq("workspace_id", auth.workspaceId)
    .in("status", ["queued", "ringing", "in_progress"])
    .gte("created_at", tenMinAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!call) {
    return NextResponse.json({ active: null });
  }

  // Get lead name
  const { data: lead } = await supabase
    .from("leads")
    .select("first_name, last_name, client")
    .eq("id", call.lead_id)
    .maybeSingle();

  const leadName = lead?.client
    ?? ([lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unknown");

  return NextResponse.json({
    active: {
      id: call.id,
      lead_id: call.lead_id,
      lead_name: leadName,
      status: call.status,
      started_at: call.created_at,
      listen_url: call.listen_url ?? null,
    },
  });
}
