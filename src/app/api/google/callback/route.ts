import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, saveTokens } from "@/modules/calendar/server";
import { getSessionMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;

  // Require a signed-in session: Google tokens are stored per-user so the
  // connecting user must be identifiable. Middleware already gates /api,
  // but we defend in depth in case this route is ever opened up.
  const auth = await getSessionMembership();
  if (!auth) {
    return NextResponse.redirect(new URL("/login?next=/", req.url));
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL("/?google=error", req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveTokens(auth.userId, tokens);
  } catch {
    return NextResponse.redirect(new URL("/?google=error", req.url));
  }

  const res = NextResponse.redirect(new URL("/?google=connected", req.url));
  res.cookies.delete("google_oauth_state");
  return res;
}
