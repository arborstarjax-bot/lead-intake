import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Returns the current quick-upload token for the logged-in admin to share
 * with the boss. The token itself lives only in env var; we hand back the
 * value here so the UI can render the bookmarkable URL without exposing
 * the secret in a public page. Only authenticated users receive it.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ token: null }, { status: 401 });

  const token = process.env.LEAD_INTAKE_UPLOAD_TOKEN ?? null;
  return NextResponse.json({ token });
}
