"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signup } from "./actions";

type Mode = "create" | "join";

export function SignupForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-full bg-[var(--surface-2)] p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`h-9 rounded-full transition-colors ${
            mode === "create"
              ? "bg-white text-[var(--fg)] shadow-sm"
              : "text-[var(--muted)]"
          }`}
        >
          Create workspace
        </button>
        <button
          type="button"
          onClick={() => setMode("join")}
          className={`h-9 rounded-full transition-colors ${
            mode === "join"
              ? "bg-white text-[var(--fg)] shadow-sm"
              : "text-[var(--muted)]"
          }`}
        >
          Join with code
        </button>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          form.set("mode", mode);
          setError(null);
          setNotice(null);
          startTransition(async () => {
            const res = await signup(form);
            if (res?.error) {
              setError(res.error);
              return;
            }
            if (res?.notice) {
              setNotice(res.notice);
              return;
            }
            router.replace("/");
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
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm"
          />
        </label>
        {mode === "create" ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
              Workspace name
            </span>
            <input
              name="workspace_name"
              type="text"
              required
              maxLength={80}
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm"
              placeholder="e.g. Arbor Tech 904"
            />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
              Join code
            </span>
            <input
              name="join_code"
              type="text"
              required
              maxLength={8}
              minLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 h-11 text-sm font-mono uppercase tracking-widest"
              placeholder="8 characters"
            />
          </label>
        )}
        {error ? (
          <div
            role="alert"
            className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg bg-emerald-50 text-emerald-700 text-sm px-3 py-2">
            {notice}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full h-11 rounded-full bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
        >
          {pending
            ? "Creating account…"
            : mode === "create"
            ? "Create workspace & sign up"
            : "Join workspace"}
        </button>
      </form>
    </div>
  );
}
