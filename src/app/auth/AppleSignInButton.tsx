"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/modules/shared/supabase/client";
import { safeNext } from "@/lib/safeRedirect";

/**
 * "Sign in with Apple" button, required by Apple Review Guideline 4.8
 * when we offer any third-party sign-in (currently email/password — and
 * soon Google) in a native iOS wrapper.
 *
 * Implementation: routes through Supabase's hosted OAuth. The button
 * kicks off a redirect to
 *   `<supabase-url>/auth/v1/authorize?provider=apple&redirect_to=<origin>/auth/callback?next=<next>`
 * Apple prompts the user, bounces back to Supabase, which then redirects
 * to our local `/auth/callback` with a `?code=` that our callback
 * exchanges for a session cookie.
 *
 * Visuals follow Apple's "Sign in with Apple" Human Interface Guidelines
 * loosely — the spec is strict about native SDK buttons but looser for
 * web. Keep black background, white text, Apple logo to the left.
 */
export function AppleSignInButton({
  next,
  label = "Continue with Apple",
}: {
  next?: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const safe = safeNext(next);
      // The callback URL needs to be absolute — Apple/Supabase require
      // a fully-qualified redirect target. We compute it from the
      // current origin so this works identically on localhost, Vercel
      // previews, and production without an env var.
      const redirectTo = `${window.location.origin}/auth/callback${
        safe && safe !== "/" ? `?next=${encodeURIComponent(safe)}` : ""
      }`;
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo,
          // Ask Apple for the user's email + name on first consent.
          // Apple only returns name on the very first authorization —
          // Supabase persists it into raw_user_meta_data for us.
          scopes: "email name",
        },
      });
      if (err) {
        setError(err.message);
        setPending(false);
      }
      // On success the browser is redirected; nothing else to do here.
    } catch (e) {
      setError((e as Error).message ?? "Apple sign-in failed");
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-black text-white text-sm font-semibold disabled:opacity-60"
        aria-label="Sign in with Apple"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <AppleLogo className="h-[18px] w-[18px]" />
        )}
        {pending ? "Redirecting…" : label}
      </button>
      {error ? (
        <div
          role="alert"
          className="rounded-lg bg-red-50 text-red-700 text-xs px-3 py-2"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

// Inline SVG so we don't pull a font dependency for a single glyph.
// Paths match Apple's official Sign in with Apple mark (simplified).
function AppleLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 384 512"
      fill="currentColor"
      className={className}
    >
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM234.3 90.2c17.4-20.7 26.4-44.8 25.2-69.9-24.2 1.8-45.1 9.9-62.1 28.3-17.8 18.7-25.8 40.2-24.4 65.5 25 2.2 47.6-10.1 61.3-23.9z" />
    </svg>
  );
}
