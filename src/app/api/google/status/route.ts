import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_oauth_tokens")
    .select("id")
    .eq("id", "default")
    .maybeSingle();
  return NextResponse.json({ connected: Boolean(data) });
}
