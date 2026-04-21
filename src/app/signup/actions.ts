"use server";

import { createSSRClient, createAdminClient } from "@/lib/supabase/server";
import { generateJoinCode } from "@/lib/auth";

type SignupResult = { error?: string; notice?: string };

/**
 * Creates a Supabase auth user AND wires them into a workspace — either a
 * brand-new one they own, or an existing one they're joining via code.
 *
 * Uses the service role (admin client) for the workspace + membership
 * writes because the user is still being created and doesn't have an
 * RLS-visible session on that transaction yet.
 */
export async function signup(form: FormData): Promise<SignupResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const mode = String(form.get("mode") ?? "create") as "create" | "join";
  if (!email || password.length < 8) {
    return { error: "Email and an 8+ character password are required" };
  }

  const admin = createAdminClient();

  // Pre-validate the join code BEFORE creating the auth user so we don't
  // orphan a half-registered account if the code is bogus.
  let targetWorkspaceId: string | null = null;
  if (mode === "join") {
    const joinCode = String(form.get("join_code") ?? "")
      .trim()
      .toUpperCase();
    if (joinCode.length !== 8) {
      return { error: "Join code must be 8 characters" };
    }
    const { data: ws } = await admin
      .from("workspaces")
      .select("id")
      .eq("join_code", joinCode)
      .maybeSingle();
    if (!ws) return { error: "No workspace found for that join code" };
    targetWorkspaceId = ws.id;
  } else {
    const wsName = String(form.get("workspace_name") ?? "").trim();
    if (!wsName) return { error: "Workspace name is required" };
  }

  // Create the auth user via the server-session client so the session
  // cookies for the new user end up in the response.
  const ssr = await createSSRClient();
  const { data: signUp, error: signUpErr } = await ssr.auth.signUp({
    email,
    password,
  });
  if (signUpErr) return { error: signUpErr.message };
  const userId = signUp.user?.id;
  if (!userId) {
    // Email confirmation is required on this project — user exists but has
    // no session. Let them know so they don't sit at a spinner.
    return {
      notice:
        "Check your email to confirm your account, then sign in to finish setup.",
    };
  }

  try {
    if (mode === "create") {
      const wsName = String(form.get("workspace_name") ?? "").trim();
      const joinCode = await generateJoinCode();
      const { data: ws, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: wsName, join_code: joinCode, created_by: userId })
        .select("id")
        .single();
      if (wsErr) throw wsErr;
      const { error: memErr } = await admin
        .from("workspace_members")
        .insert({ workspace_id: ws.id, user_id: userId, role: "admin" });
      if (memErr) throw memErr;
      // Seed an empty settings row so /settings has something to read.
      await admin.from("app_settings").insert({ workspace_id: ws.id });
    } else {
      const { error: memErr } = await admin
        .from("workspace_members")
        .insert({
          workspace_id: targetWorkspaceId!,
          user_id: userId,
          role: "user",
        });
      if (memErr) throw memErr;
    }
  } catch (e) {
    // Best-effort rollback: if we succeeded at signUp but couldn't wire
    // up the workspace, delete the auth user so they can try again.
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // ignore — admin can clean this up manually if both fail
    }
    return { error: (e as Error).message || "Signup failed" };
  }

  return {};
}
