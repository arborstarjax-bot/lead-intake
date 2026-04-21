import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Permanent account deletion. Required for App Store / Play Store review
 * and Article 17 (right to erasure) under GDPR.
 *
 * Flow per workspace the caller belongs to:
 *   - If caller is the only member → delete the workspace (cascades
 *     leads, app_settings, storage buckets via ON DELETE CASCADE).
 *   - If caller is the only admin but other members exist → block with
 *     409 so they promote someone first. Deleting would leave an
 *     ownerless workspace that nobody can administer.
 *   - Otherwise → remove their membership row; the workspace lives on.
 *
 * Then `auth.admin.deleteUser(userId)` removes the auth row. Cascades
 * clean up per-user tables (push_subscriptions, google_oauth_tokens,
 * any remaining workspace_members rows).
 */
export async function DELETE() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const admin = createAdminClient();

  const { data: memberships, error: memErr } = await admin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", auth.userId);
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  for (const m of memberships ?? []) {
    const { data: allInWs, error: allErr } = await admin
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", m.workspace_id);
    if (allErr) {
      return NextResponse.json({ error: allErr.message }, { status: 500 });
    }
    const others = (allInWs ?? []).filter((r) => r.user_id !== auth.userId);

    if (others.length === 0) {
      const { error: delWsErr } = await admin
        .from("workspaces")
        .delete()
        .eq("id", m.workspace_id);
      if (delWsErr) {
        return NextResponse.json({ error: delWsErr.message }, { status: 500 });
      }
      continue;
    }

    const otherAdmins = others.filter((r) => r.role === "admin");
    if (m.role === "admin" && otherAdmins.length === 0) {
      return NextResponse.json(
        {
          error:
            "You are the only admin of this workspace. Promote another member to admin before deleting your account.",
        },
        { status: 409 }
      );
    }

    const { error: delMemErr } = await admin
      .from("workspace_members")
      .delete()
      .eq("workspace_id", m.workspace_id)
      .eq("user_id", auth.userId);
    if (delMemErr) {
      return NextResponse.json({ error: delMemErr.message }, { status: 500 });
    }
  }

  // `workspaces.created_by` is ON DELETE RESTRICT, so any surviving
  // workspace this user originally created would block deleteUser().
  // Surviving = we didn't delete it above because other members remain.
  // Null it out: the workspace stays alive under its remaining admins.
  const { error: nullCreatedByErr } = await admin
    .from("workspaces")
    .update({ created_by: null })
    .eq("created_by", auth.userId);
  if (nullCreatedByErr) {
    return NextResponse.json(
      { error: nullCreatedByErr.message },
      { status: 500 }
    );
  }

  const { error: delUserErr } = await admin.auth.admin.deleteUser(auth.userId);
  if (delUserErr) {
    return NextResponse.json({ error: delUserErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
