import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { TASK_EDITABLE_COLUMNS } from "@/modules/tasks/model";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  // Verify ownership
  const { data: existing } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  for (const key of TASK_EDITABLE_COLUMNS) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
