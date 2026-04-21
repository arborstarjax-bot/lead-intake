"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login } from "./actions";
import { safeNext } from "@/lib/safeRedirect";

export function LoginForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(initialError ?? null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const res = await login(form);
          if (res?.error) {
            setError(res.error);
            return;
          }
          router.replace(safeNext(next));
          router.refresh();
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
      <label className="block space-y-1">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
          Password
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
