import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, saveTokens } from "@/lib/google/oauth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL("/?google=error", req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveTokens(user.id, tokens);
  } catch {
    return NextResponse.redirect(new URL("/?google=error", req.url));
  }

  const res = NextResponse.redirect(new URL("/?google=connected", req.url));
  res.cookies.delete("google_oauth_state");
  return res;
}
