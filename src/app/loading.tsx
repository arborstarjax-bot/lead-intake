import { Loader2 } from "lucide-react";

/**
 * Root-level loading fallback. Next.js shows this while a server
 * component is suspended (pre-render, data fetch, etc.). Intentionally
 * minimal — no skeleton — so it doesn't fight segment-level loading
 * states that already exist in /route and /leads.
 */
export default function RootLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-dvh flex items-center justify-center bg-[var(--bg)] text-[var(--muted)]"
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
