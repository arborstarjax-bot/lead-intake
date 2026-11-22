"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/modules/shared/supabase/client";
import { safeNext } from "@/lib/safeRedirect";

/**
 * "Sign in with Google" button — same Supabase hosted OAuth flow as
 * AppleSignInButton:
 *   `<supabase-url>/auth/v1/authorize?provider=google&redirect_to=<origin>/auth/callback?next=<next>`
 * Google prompts for account selection, bounces back through Supabase to
 * `/auth/callback` with a `?code=` our callback exchanges for a session.
 */
export function GoogleSignInButton({
  next,
  label = "Continue with Google",
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
      const redirectTo = `${window.location.origin}/auth/callback${
        safe && safe !== "/" ? `?next=${encodeURIComponent(safe)}` : ""
      }`;
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          scopes: "email profile",
          queryParams: { prompt: "select_account" },
        },
      });
      if (err) {
        setError(err.message);
        setPending(false);
      }
    } catch (e) {
      setError((e as Error).message ?? "Google sign-in failed");
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full border border-[var(--border)] bg-white text-[var(--fg)] text-sm font-semibold disabled:opacity-60"
        aria-label="Sign in with Google"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleLogo className="h-[18px] w-[18px]" />
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

// Google's official multicolor "G" mark.
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
