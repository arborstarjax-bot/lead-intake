import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Routes that don't require authentication:
// - Auth pages themselves
// - Auth callback (magic-link / email-confirm redirect target)
// - Public health endpoint
// - PWA shell assets (manifest, SW, icons) and Next static
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/auth",
  "/api/auth",
  "/api/health",
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
  const { response, user } = await updateSession(request);

  if (isPublic(pathname)) {
    // If a signed-in user hits /login or /signup, bounce them into the app.
    if (user && (pathname === "/login" || pathname === "/signup")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so we can redirect back after login.
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
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
