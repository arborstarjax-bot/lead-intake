/**
 * Validate a user-supplied `next` query parameter so we only ever redirect
 * back to an internal path — never to an arbitrary external URL. Blocks
 * protocol-relative URLs (`//evil.com`) and backslash tricks that some
 * parsers treat as slashes (`/\evil.com`).
 */
export function safeNext(next: string | undefined | null, fallback = "/"): string {
  if (!next) return fallback;
  if (typeof next !== "string") return fallback;
  // Must be an absolute path on this origin.
  if (!next.startsWith("/")) return fallback;
  // Block protocol-relative (`//host`) and backslash-prefixed paths.
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
