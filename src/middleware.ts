import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/modules/shared/supabase/middleware";

// Routes that don't require authentication:
// - Auth pages themselves
// - Auth callback (magic-link / email-confirm redirect target)
// - Public health endpoint
// - Stripe webhook (Stripe POSTs server-to-server, signature-authed by the
//   route handler; redirecting to /login here would fail every delivery
//   with a 307)
// - PWA shell assets (manifest, SW, icons) and Next static
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/api/auth",
  "/api/health",
  "/api/stripe",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons",
  "/_next",
  "/favicon.ico",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, user, supabase } = await updateSession(request);

  // Public paths always pass through. Note: signed-in users are NOT
  // bounced away from /login or /signup — those pages handle it
  // themselves. Doing it here would trap a signed-in user with no
  // workspace membership (e.g. after an admin removed them) in a redirect
  // loop between /workspace → /login → / with every API call 401ing and
  // no way to sign out or rejoin a workspace.
  if (isPublic(pathname)) {
    return response;
  }

  if (!user) {
    // API callers need JSON 401, not an HTML redirect to /login. When an
    // Authorization header is present (e.g. Bearer lf_live_…), let the
    // request through — resolveApiAuth in the route does the actual
    // token verification. Without any header, 401 right here.
    if (pathname.startsWith("/api")) {
      if (request.headers.get("authorization")) return response;
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Authentication required" } },
        { status: 401 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so we can redirect back after login.
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Signed in but possibly orphaned (no workspace_members row — e.g. an
  // admin removed them or signup never finished wiring a workspace).
  // Page renders below assume a workspace and crash without one; send
  // them to /workspace which shows the create/join-or-sign-out state.
  // Skipped for API routes (they 401 via requireMembership already) and
  // for /workspace itself.
  if (!pathname.startsWith("/api") && pathname !== "/workspace") {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership) {
      const url = request.nextUrl.clone();
      url.pathname = "/workspace";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and image optimisation. The
  // function itself still short-circuits public paths above so static
  // assets aren't meaningfully taxed.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
