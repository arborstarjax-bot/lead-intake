import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth";
import { LEAD_ACTIVITY_TYPES } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Per-lead activity log. Reads return the chronological timeline for the
 * lead; writes accept a subset of types that are "user-initiated" (call /
 * text click). Lifecycle events (lead_scheduled, lead_completed) are
 * written server-side from the PATCH handler so they stay authoritative —
 * we don't trust clients to decide when a status transition happened.
 */

const CLIENT_WRITABLE_TYPES = ["customer_called", "customer_texted"] as const;
type ClientWritableType = (typeof CLIENT_WRITABLE_TYPES)[number];

const postSchema = z
  .object({
    type: z.enum(CLIENT_WRITABLE_TYPES),
    // Details is freeform but bounded to prevent abuse. Keys like "outcome"
    // ("answered" / "missed") let the UI surface richer copy later without
    // another migration.
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  // Gate on membership: ensure the lead belongs to this workspace before
  // leaking anything about it. 404 for both "not found" and "other
  // workspace" to avoid probing attacks.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!lead || lead.workspace_id !== auth.workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("lead_activities")
    .select("id, lead_id, type, details, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ activities: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!lead || lead.workspace_id !== auth.workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 }
    );
  }
  const type: ClientWritableType = parsed.data.type;
  // Defense-in-depth: belt-and-suspenders check against the canonical
  // enum in case the zod schema drifts from lib/types.
  if (!LEAD_ACTIVITY_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("lead_activities")
    .insert({
      workspace_id: auth.workspaceId,
      lead_id: id,
      type,
      details: parsed.data.details ?? {},
    })
    .select("id, lead_id, type, details, created_at")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ activity: data });
}
