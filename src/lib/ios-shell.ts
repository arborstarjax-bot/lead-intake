/**
 * iOS shell detection.
 *
 * LeadFlow is shipped as (a) a web PWA at the canonical domain and (b)
 * the same web bundle wrapped in a Capacitor / WKWebView shell
 * published to the App Store. The shell is the only place where Apple
 * App Review Guideline 3.1.1 applies — it prohibits Stripe (or any
 * non-IAP) purchase flow for digital goods inside an iOS app.
 *
 * We qualify for the Guideline 3.1.3(b) business-services exemption
 * (B2B CRM provisioned outside the app, multi-user workspaces with
 * admin-managed seats). The exemption requires that the app not
 * present purchase or upgrade UI inside the shell — management must
 * happen on the web.
 *
 * This module is the single source of truth for "are we in the shell?"
 *
 *   - `isIosShellUserAgent`  — pure, works server-side and client.
 *     Matches both Capacitor's default UA augmentation (`Capacitor/*`)
 *     and the explicit `LeadFlowiOS/*` marker we set in the shell's
 *     Info.plist WKWebView UA override (Phase 2).
 *
 *   - `isIosShellWindow` — client-side runtime probe. Prefers the
 *     canonical `window.Capacitor.isNativePlatform()` API and falls
 *     back to the UA check when the global isn't injected yet
 *     (e.g. during an early render before the bridge loads).
 *
 * Until Phase 2 wraps the app in Capacitor, every caller sees `false`
 * — behavior on the web is unchanged.
 */

export function isIosShellUserAgent(
  userAgent: string | null | undefined
): boolean {
  if (!userAgent) return false;
  return /Capacitor\//i.test(userAgent) || /LeadFlowiOS/i.test(userAgent);
}

/** Minimal local shape so we don't need `@capacitor/core` as a web
 *  dependency — the shell injects the global at runtime. */
type CapacitorWindow = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
};

export function isIosShellWindow(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as CapacitorWindow).Capacitor;
  if (cap && typeof cap.isNativePlatform === "function") {
    if (cap.isNativePlatform()) return true;
  }
  if (typeof navigator !== "undefined") {
    return isIosShellUserAgent(navigator.userAgent);
  }
  return false;
}
