import "server-only";
import { NextResponse } from "next/server";
import { createSSRClient, createAdminClient } from "@/modules/shared/supabase/server";

export type WorkspaceMembership = {
  userId: string;
  email: string | null;
  workspaceId: string;
  workspaceName: string;
  role: "admin" | "user";
  joinCode: string;
};

/**
 * Reads the authenticated user + their primary workspace membership.
 * Returns null if the user isn't signed in or isn't a member of any
 * workspace yet (e.g. just verified their email, hasn't joined one).
 *
 * A user can only belong to one workspace at a time in the current
 * product, so we return the first membership row and ignore the rest.
 */
export async function getSessionMembership(): Promise<WorkspaceMembership | null> {
  const supabase = await createSSRClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const { data: row } = await supabase
    .from("workspace_members")
    .select(
      "role, workspace:workspaces!inner(id, name, join_code)"
    )
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<{
      role: "admin" | "user";
      workspace: { id: string; name: string; join_code: string };
    }>();

  if (!row) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    workspaceId: row.workspace.id,
    workspaceName: row.workspace.name,
    role: row.role,
    joinCode: row.workspace.join_code,
  };
}

/**
 * API-route helper: returns a membership or a 401/403 NextResponse. Call
 * sites pattern-match on which branch they got:
 *
 *   const auth = await requireMembership();
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.userId, auth.workspaceId, auth.role available here
 */
export async function requireMembership(): Promise<WorkspaceMembership | NextResponse> {
  const m = await getSessionMembership();
  if (!m) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return m;
}

export async function requireAdmin(): Promise<WorkspaceMembership | NextResponse> {
  const m = await requireMembership();
  if (m instanceof NextResponse) return m;
  if (m.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  return m;
}

/**
 * Generate an 8-character uppercase workspace join code with unambiguous
 * characters only (no 0/O, no 1/I). Collisions are extremely unlikely
 * at small scale (32^8 ≈ 10^12) but we retry a handful of times just in
 * case.
 */
export async function generateJoinCode(): Promise<string> {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 chars
  const admin = createAdminClient();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let code = "";
    for (let i = 0; i < 8; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const { data } = await admin
      .from("workspaces")
      .select("id")
      .eq("join_code", code)
      .maybeSingle();
    if (!data) return code;
  }
  throw new Error("could not generate a unique join code; try again");
}
