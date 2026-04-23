"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Persistent banner that surfaces the offline state to the user.
 *
 * Why this exists:
 *   - App Store reviewers test with airplane mode. A PWA that appears
 *     unresponsive when offline — because writes are silently queued
 *     by `OfflineQueueReplayer` but nothing on screen changes — reads
 *     as broken under Guideline 4.2 (Minimum Functionality).
 *   - The offline queue already handles the write side. This is the
 *     *read* side: tell the user "we know, your edits will sync when
 *     you reconnect" so the app feels intentional instead of frozen.
 *
 * Behavior:
 *   - Hidden by default (pre-SSR / online).
 *   - Watches `online` / `offline` window events and re-reads
 *     `navigator.onLine` on mount in case we load while already offline.
 *   - Fixed to the top of the viewport so it's visible on every page
 *     without adding to each page's DOM.
 *   - Respects `env(safe-area-inset-top)` — iOS notch / Dynamic Island
 *     would otherwise overlap the bar in a Capacitor / WKWebView shell.
 *   - `pointer-events: none` on the wrapper so it never intercepts
 *     taps on the UI underneath — the banner is informational only.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOffline(navigator.onLine === false);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="pointer-events-auto mt-2 flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 shadow-sm ring-1 ring-amber-200">
        <WifiOff className="h-4 w-4" aria-hidden="true" />
        <span>You&apos;re offline — changes will sync when you reconnect.</span>
      </div>
    </div>
  );
}
