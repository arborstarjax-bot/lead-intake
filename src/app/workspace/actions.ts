"use server";

import { createAdminClient, createSSRClient } from "@/modules/shared/supabase/server";

/**
 * Lets a signed-in user with no workspace membership join an existing
 * workspace via its join code. Used by the orphan state on /workspace
 * so kicked / email-confirmed-but-unassigned users can recover without
 * having to sign out first.
 */
export async function joinExistingWorkspace(
  joinCode: string
): Promise<{ error?: string }> {
  const code = (joinCode ?? "").trim().toUpperCase();
  if (code.length !== 8) {
    return { error: "Join code must be 8 characters" };
  }

  const ssr = await createSSRClient();
  const { data: userRes } = await ssr.auth.getUser();
  const user = userRes.user;
  if (!user) return { error: "Not signed in" };

  const admin = createAdminClient();

  // If the user already has a membership, don't touch anything — just
  // let the caller redirect into the app.
  const { data: existing } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (existing) return {};

  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .eq("join_code", code)
    .maybeSingle();
  if (!ws) return { error: "No workspace found for that join code" };

  const { error: memErr } = await admin
    .from("workspace_members")
    .insert({ workspace_id: ws.id, user_id: user.id, role: "user" });
  if (memErr) return { error: memErr.message };

  return {};
}
