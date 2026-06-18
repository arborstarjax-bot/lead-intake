import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const status = req.nextUrl.searchParams.get("status");

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .order("start_at", { ascending: true });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const payload = await req.json().catch(() => ({}));
  const { workspace_id: _drop, ...safe } = payload ?? {};
  void _drop;

  if (!safe.name || !safe.start_at || !safe.end_at) {
    return NextResponse.json(
      { error: "name, start_at, and end_at are required" },
      { status: 400 },
    );
  }

  // Default assignee to workspace default salesperson if not set
  if (!safe.assignee) {
    try {
      const settings = await getSettings(auth.workspaceId);
      if (settings.default_salesperson) {
        safe.assignee = settings.default_salesperson;
      }
    } catch {
      // Non-blocking
    }
  }

  // Auto-generate task name: "Assignee - Task" if not provided with that pattern
  if (safe.assignee && !safe.name.includes(" - ")) {
    safe.name = `${safe.assignee} - ${safe.name}`;
  }

  const row = {
    ...safe,
    workspace_id: auth.workspaceId,
    created_by: auth.userId,
    status: safe.status || "Scheduled",
    extraction_source: safe.extraction_source || "manual",
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert(row)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
