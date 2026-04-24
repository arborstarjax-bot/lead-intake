"use server";

import { createAdminClient, createSSRClient } from "@/modules/shared/supabase/server";
import { generateJoinCode } from "@/modules/auth/server";

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

/**
 * Lets a signed-in user with no workspace membership create a brand
 * new workspace they own as admin. Used by the orphan state after
 * OAuth sign-in (Apple / Google) where the user never went through
 * /signup and therefore has no workspace yet.
 *
 * Mirrors the "create" branch of /signup/actions.ts but without the
 * auth user creation step (the user already exists). Kept as a
 * separate action so the orphan page can also expose "Join with code"
 * without forcing everyone through a single monolithic form.
 */
export async function createOwnWorkspace(
  name: string
): Promise<{ error?: string }> {
  const wsName = (name ?? "").trim();
  if (!wsName) return { error: "Workspace name is required" };
  if (wsName.length > 80) return { error: "Workspace name is too long" };

  const ssr = await createSSRClient();
  const { data: userRes } = await ssr.auth.getUser();
  const user = userRes.user;
  if (!user) return { error: "Not signed in" };

  const admin = createAdminClient();

  // If the user already has a membership, don't create a duplicate —
  // the orphan page should have redirected them elsewhere. Treat as
  // success so the caller routes into the app.
  const { data: existing } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (existing) return {};

  const joinCode = await generateJoinCode();
  const { data: ws, error: wsErr } = await admin
    .from("workspaces")
    .insert({ name: wsName, join_code: joinCode, created_by: user.id })
    .select("id")
    .single();
  if (wsErr) return { error: wsErr.message };

  const { error: memErr } = await admin
    .from("workspace_members")
    .insert({ workspace_id: ws.id, user_id: user.id, role: "admin" });
  if (memErr) return { error: memErr.message };

  // Seed an empty settings row to match the /signup create path.
  await admin.from("app_settings").insert({ workspace_id: ws.id });

  return {};
}
