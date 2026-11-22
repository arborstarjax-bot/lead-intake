/**
 * Validate a user-supplied `next` query parameter so we only ever redirect
 * back to an internal path — never to an arbitrary external URL.
 *
 * Rejects control characters (tabs/newlines are stripped by browsers' URL
 * parser before validation, so `/%09/evil.com` would become `//evil.com`),
 * backslashes (some parsers treat them as slashes), and anything that does
 * not parse to a path on this origin.
 */
export function safeNext(next: string | undefined | null, fallback = "/"): string {
  if (!next || typeof next !== "string") return fallback;
  // Browsers strip tabs/newlines before URL parsing; a `next` containing any
  // control character could smuggle in `//host` after sanitization.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "https://placeholder.invalid");
    if (url.origin !== "https://placeholder.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
