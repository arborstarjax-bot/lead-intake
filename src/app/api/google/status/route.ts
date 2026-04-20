import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false });

  const admin = createAdminClient();
  const { data } = await admin
    .from("google_oauth_tokens")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ connected: Boolean(data) });
}
