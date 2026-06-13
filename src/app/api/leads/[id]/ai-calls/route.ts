import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

/**
 * Returns the AI call history for a lead from the `ai_calls` table.
 * Each row includes status, duration, summary, recording_url, and timestamps.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  // Verify the lead belongs to this workspace
  const { data: lead } = await supabase
    .from("leads")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!lead || lead.workspace_id !== auth.workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("ai_calls")
    .select(
      "id, status, duration_secs, call_summary, recording_url, created_at, ended_at, started_at"
    )
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ calls: data ?? [] });
}
