import { NextResponse } from "next/server";
import { requireMembership, requireAdmin, generateJoinCode } from "@/modules/auth/server";
import { createAdminClient } from "@/modules/shared/supabase/server";

export const dynamic = "force-dynamic";

type MemberRow = {
  user_id: string;
  role: "admin" | "user";
  created_at: string;
};

/**
 * Return the caller's workspace summary + member list. Admin actions
 * (rotate code, kick, promote) live under /api/workspace/* below.
 */
export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const admin = createAdminClient();
  const { data: memberRows } = await admin
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: true });

  // auth.users is not queryable via PostgREST by default. Use the admin
  // API's listUsers — workspaces are small (handful of people), so a
  // single page of 1000 is always enough.
  const { data: users } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const emailById = new Map<string, string>();
  for (const u of users?.users ?? []) {
    if (u.id && u.email) emailById.set(u.id, u.email);
  }

  const members = (memberRows ?? []).map((m: MemberRow) => ({
    userId: m.user_id,
    email: emailById.get(m.user_id) ?? null,
    role: m.role,
    joinedAt: m.created_at,
    isSelf: m.user_id === auth.userId,
  }));

  return NextResponse.json({
    workspace: {
      id: auth.workspaceId,
      name: auth.workspaceName,
      joinCode: auth.joinCode,
    },
    role: auth.role,
    members,
  });
}

/**
 * Rotate the workspace join code so a leaked code stops onboarding new
 * members. Admin only.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const admin = createAdminClient();
  const joinCode = await generateJoinCode();
  const { error } = await admin
    .from("workspaces")
    .update({ join_code: joinCode })
    .eq("id", auth.workspaceId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ joinCode });
}
