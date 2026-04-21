import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { LOST_AFTER_DAYS } from "@/lib/types";
import { requireMembership } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Best-effort sweep: promote any "Called / No Response" lead whose status
 * hasn't changed in >= LOST_AFTER_DAYS to "Lost". Runs before every list
 * fetch so the UI stays consistent without a scheduled job. Scoped to the
 * caller's workspace so one workspace's stale leads never affect another.
 */
async function sweepLostLeads(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<void> {
  const cutoff = new Date(
    Date.now() - LOST_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  try {
    await supabase
      .from("leads")
      .update({ status: "Lost" })
      .eq("workspace_id", workspaceId)
      .eq("status", "Called / No Response")
      .lt("status_changed_at", cutoff);
  } catch {
    // column missing or other transient error — ignore; sweep resumes next request
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  await sweepLostLeads(supabase, auth.workspaceId);

  const view = req.nextUrl.searchParams.get("view") ?? "active";
  let query = supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false });
  if (view === "completed") {
    query = query.eq("status", "Completed");
  } else if (view === "all") {
    // no status filter
  } else {
    query = query.neq("status", "Completed");
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data });
}

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const payload = await req.json().catch(() => ({}));
  // Never trust workspace_id from the client — always stamp it from session.
  const { workspace_id: _drop, ...safe } = payload ?? {};
  void _drop;
  const base = {
    status: "New" as const,
    intake_source: "manual" as const,
    intake_status: "ready" as const,
    ...safe,
    workspace_id: auth.workspaceId,
  };
  if (!base.client) {
    base.client = displayName(base.first_name, base.last_name) || null;
  }

  const { data, error } = await supabase
    .from("leads")
    .insert(base)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lead: data });
}
