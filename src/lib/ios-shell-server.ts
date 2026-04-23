import "server-only";

import { headers } from "next/headers";
import { isIosShellUserAgent } from "./ios-shell";

/**
 * Server-side iOS-shell detection. Reads the incoming request's
 * User-Agent via `next/headers` and delegates to the shared matcher.
 *
 * Use this in server components / route handlers to gate server-rendered
 * billing and upgrade UI when the request came from the Capacitor
 * shell (App Store Guideline 3.1.1 / 3.1.3(b) — see `./ios-shell.ts`).
 *
 * `headers()` is async in Next 15.
 */
export async function isIosShellRequest(): Promise<boolean> {
  const h = await headers();
  return isIosShellUserAgent(h.get("user-agent"));
}
