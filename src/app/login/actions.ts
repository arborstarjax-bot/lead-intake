"use server";

import { createSSRClient } from "@/modules/shared/supabase/server";

export async function login(form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Email and password required" };

  const supabase = await createSSRClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return {};
}

export async function logout(): Promise<void> {
  const supabase = await createSSRClient();
  await supabase.auth.signOut();
}
