"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <div
        role="status"
        className="rounded-lg bg-emerald-50 text-emerald-800 text-sm px-3 py-3 text-center"
      >
        If an account exists for <strong>{sentTo}</strong>, a password reset
        link is on the way. Check your inbox (and spam folder) — the link
        expires in about an hour.
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const email = String(form.get("email") ?? "").trim().toLowerCase();
        if (!email) return;
        setError(null);
        startTransition(async () => {
          const supabase = createClient();
          const { error: resetError } = await supabase.auth.resetPasswordForEmail(
            email,
            {
              redirectTo: `${window.location.origin}/reset-password`,
            }
          );
          if (resetError) {
            setError(resetError.message);
            return;
          }
          // Supabase already returns success for unknown emails to prevent
          // account enumeration — mirror that by always showing the "sent"
          // confirmation without leaking whether an account exists.
          setSentTo(email);
        });
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
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
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
