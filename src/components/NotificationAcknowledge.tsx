"use client";

import { useEffect } from "react";

/**
 * Fire-and-forget component mounted on /leads. On mount it:
 *   - clears the app icon badge (no-op on platforms that don't support it)
 *   - tells the server this device has now seen the latest leads, so the
 *     next push arrives with badgeCount 1, not N+1.
 *   - closes any lingering notification banners the OS has for this app.
 */
export default function NotificationAcknowledge() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const nav = window.navigator as Navigator & {
      clearAppBadge?: () => Promise<void>;
    };
    if (typeof nav.clearAppBadge === "function") {
      nav.clearAppBadge().catch(() => {});
    }

    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then(async (reg) => {
        // Dismiss any banners still sitting on the lock screen.
        try {
          const notes = await reg.getNotifications({ tag: "new-lead" });
          notes.forEach((n) => n.close());
        } catch {}

        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        await fetch("/api/push/acknowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
      })
      .catch(() => {});
  }, []);

  return null;
}
