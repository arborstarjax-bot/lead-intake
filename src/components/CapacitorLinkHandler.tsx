"use client";

import { useEffect } from "react";

/**
 * In a Capacitor / WKWebView shell, a plain `<a target="_blank">`
 * opens a blank page inside the same webview with no chrome and no
 * way back — Apple's review bots flag this under Guideline 4.2
 * ("Minimum Functionality") because the user gets trapped. Links
 * need to open in the system browser (SFSafariViewController via
 * the Capacitor Browser plugin) so the back button works and the
 * URL bar is visible.
 *
 * This component installs a single document-level click handler that:
 *
 *   1. Only activates when `window.Capacitor?.isNativePlatform?.()`
 *      returns true. In a regular mobile / desktop browser the
 *      handler is a no-op and the default `<a target="_blank">`
 *      behavior runs unchanged.
 *
 *   2. Intercepts anchor clicks whose href starts with `http(s)://`
 *      AND either has `target="_blank"` or `data-external`. It calls
 *      `window.Capacitor.Plugins.Browser.open({ url })` and prevents
 *      the default.
 *
 *   3. Leaves `tel:` / `mailto:` / `sms:` alone — Capacitor's
 *      default WKWebView config routes those through iOS's native
 *      handlers (dialer, Mail, Messages) correctly.
 *
 * Mounted once at the root layout so every page inherits the
 * behavior without call-site changes. No-op on the server (useEffect
 * never runs).
 */
export function CapacitorLinkHandler() {
  useEffect(() => {
    const cap = (window as unknown as CapacitorWindow).Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function") return;
    if (!cap.isNativePlatform()) return;
    const browser = cap.Plugins?.Browser;
    if (!browser || typeof browser.open !== "function") return;

    const handler = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const isHttp = /^https?:\/\//i.test(href);
      if (!isHttp) return;
      const opensInNewTab =
        anchor.getAttribute("target") === "_blank" ||
        anchor.hasAttribute("data-external");
      if (!opensInNewTab) return;
      event.preventDefault();
      browser.open({ url: href }).catch(() => {
        // Fallback to default navigation if the native bridge rejects —
        // better a stuck webview than a silent no-op.
        window.location.href = href;
      });
    };

    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return null;
}

/** Minimal shape of the Capacitor runtime globals we rely on. Declared
 *  locally so we don't need `@capacitor/core` as a web dependency — the
 *  shell injects the global at runtime. */
type CapacitorWindow = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      Browser?: {
        open?: (options: { url: string }) => Promise<void>;
      };
    };
  };
};
