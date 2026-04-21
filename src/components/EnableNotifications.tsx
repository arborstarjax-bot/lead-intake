"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";

type Status = "unsupported" | "denied" | "prompt" | "subscribing" | "subscribed";

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export default function EnableNotifications() {
  const [status, setStatus] = useState<Status>("prompt");
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window) ||
      !publicKey
    ) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setStatus(existing ? "subscribed" : "prompt");
    });
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setStatus("subscribing");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "prompt");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("subscribed");
    } catch (e) {
      console.error(e);
      alert(
        `Couldn't enable notifications: ${(e as Error).message}. ` +
          `On iPhone, notifications only work after you Add to Home Screen.`
      );
      setStatus("prompt");
    }
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("prompt");
    } catch (e) {
      console.error(e);
    }
  }

  if (status === "unsupported") {
    return (
      <button
        disabled
        title="On iPhone: Add this app to your Home Screen first, then reopen and try again."
        className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 h-9 text-xs text-[var(--muted)]"
      >
        <BellOff className="h-4 w-4" />
        Notifications unavailable
      </button>
    );
  }
  if (status === "denied") {
    return (
      <button
        disabled
        title="You blocked notifications. Enable them in your browser/iOS settings for this site."
        className="inline-flex items-center gap-1 rounded-md border border-[var(--danger)] text-[var(--danger)] px-3 h-9 text-xs"
      >
        <BellOff className="h-4 w-4" />
        Notifications blocked
      </button>
    );
  }
  if (status === "subscribed") {
    return (
      <button
        onClick={disable}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-400 bg-emerald-50 text-emerald-700 px-3 h-9 text-xs font-medium"
        title="Notifications on — click to turn off"
      >
        <BellRing className="h-4 w-4" />
        Notifications On
      </button>
    );
  }
  return (
    <button
      onClick={enable}
      disabled={status === "subscribing"}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)] text-[var(--accent)] hover:bg-blue-50 px-3 h-9 text-xs font-medium"
    >
      <Bell className="h-4 w-4" />
      {status === "subscribing" ? "Enabling…" : "Enable Notifications"}
    </button>
  );
}
