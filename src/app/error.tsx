"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Global client-error boundary. Next.js renders this instead of a blank
 * white screen when any client component in the tree throws. The
 * `reset` prop re-runs the segment — fine for transient failures
 * (network blip, race condition); for truly broken state the user
 * can bail out to /leads.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in the browser console so real stack traces are still
    // inspectable; we intentionally don't ship a logging service yet.
    console.error("Client error boundary caught:", error);
  }, [error]);

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--border)] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-[var(--muted)]">
            Your data is safe — this is just a display hiccup. Try reloading, or jump back to your leads.
          </p>
          {error.digest ? (
            <p className="text-[11px] text-[var(--subtle)] font-mono pt-1">
              ref: {error.digest}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 h-11 flex-1 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/leads"
            className="inline-flex items-center justify-center h-11 flex-1 rounded-full border border-[var(--border)] bg-white text-sm font-medium text-[var(--fg)]"
          >
            Back to leads
          </Link>
        </div>
      </div>
    </main>
  );
}
