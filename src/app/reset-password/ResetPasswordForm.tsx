"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Phase = "verifying" | "ready" | "invalid" | "done";

export function ResetPasswordForm() {
  const [phase, setPhase] = useState<Phase>("verifying");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase's default browser client has detectSessionInUrl=true, so the
    // recovery tokens in the URL hash (#access_token=...&type=recovery) are
    // consumed on load. We wait for either an existing session or the
    // PASSWORD_RECOVERY event before showing the new-password form.
    const supabase = createClient();
    let settled = false;

    const settle = (next: Phase) => {
      if (settled) return;
      settled = true;
      setPhase(next);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) settle("ready");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        settle("ready");
      }
    });

    // If nothing has fired after a beat, the link is bad or expired.
    const timer = window.setTimeout(() => settle("invalid"), 4000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  if (phase === "verifying") {
    return (
      <div className="text-sm text-center text-[var(--muted)]">
        Verifying reset link…
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-3 text-center"
        >
          This reset link is invalid or expired. Request a new one.
        </div>
        <Link
          href="/forgot-password"
          className="block text-center h-11 leading-[44px] w-full rounded-full bg-[var(--accent)] text-white text-sm font-semibold"
        >
          Send a new link
        </Link>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-lg bg-emerald-50 text-emerald-800 text-sm px-3 py-3 text-center"
        >
          Password updated. You can now sign in with your new password.
        </div>
        <Link
          href="/login"
          className="block text-center h-11 leading-[44px] w-full rounded-full bg-[var(--accent)] text-white text-sm font-semibold"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const password = String(form.get("password") ?? "");
        const confirm = String(form.get("confirm") ?? "");
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          return;
        }
        if (password !== confirm) {
          setError("Passwords don't match");
          return;
        }
        setError(null);
        startTransition(async () => {
          const supabase = createClient();
          const { error: updateError } = await supabase.auth.updateUser({
            password,
          });
          if (updateError) {
            setError(updateError.message);
            return;
          }
          // Sign out the recovery session so the user is forced to sign in
          // with the fresh password (server cookies won't have this session
          // anyway — keeps the state consistent).
          await supabase.auth.signOut();
          setPhase("done");
        });
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
          New password
        </span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
          Confirm password
        </span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm"
        />
      </label>
      {error ? (
        <div
          role="alert"
          className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2"
        >
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full h-11 rounded-full bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
