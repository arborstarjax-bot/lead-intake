import { NextResponse, type NextRequest } from "next/server";
import { createSSRClient } from "@/modules/shared/supabase/server";
import { safeNext } from "@/lib/safeRedirect";

export const dynamic = "force-dynamic";

/**
 * OAuth redirect handler for Supabase-managed providers (Apple, Google,
 * etc.). The provider sends the user back here with a `?code=...`
 * query param; we exchange it for a session via Supabase SSR (which
 * sets the session cookie on our domain) and then forward the browser
 * to `?next=...` (defaulting to `/`).
 *
 * Error modes:
 *   - `?error_description=...` already set by the provider → bounce back
 *     to /login surfacing that message. We don't want a silent dead-end
 *     when Apple declines consent or rate-limits us.
 *   - `exchangeCodeForSession` fails locally (expired code, replay, CSRF
 *     mismatch) → also bounce to /login with the error.
 *
 * New OAuth users don't have a workspace membership yet; the middleware
 * + /workspace orphan view handle that path separately. We do NOT
 * create a default workspace here — the user needs to pick create vs.
 * join explicitly.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const providerErr = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerErr) {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", providerErr);
    return NextResponse.redirect(url);
  }

  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next") ?? "/");

  if (!code) {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", "Missing auth code from provider.");
    return NextResponse.redirect(url);
  }

  const supabase = await createSSRClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const url = new URL(`${origin}/login`);
    url.searchParams.set("error", error.message);
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(next, origin));
}
