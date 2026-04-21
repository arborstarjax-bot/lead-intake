import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * Friendlier 404 than Next's default. Rendered whenever a route segment
 * calls `notFound()` or no route matches.
 */
export default function NotFound() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12 bg-[var(--bg)]">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--border)] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
          <Compass className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Page not found</h1>
          <p className="text-sm text-[var(--muted)]">
            The link might be stale, or you mistyped the URL.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Link
            href="/leads"
            className="inline-flex items-center justify-center h-11 flex-1 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-semibold"
          >
            Back to leads
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center h-11 flex-1 rounded-full border border-[var(--border)] bg-white text-sm font-medium text-[var(--fg)]"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
