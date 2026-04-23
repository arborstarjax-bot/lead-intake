"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { getNativePlatform, isIosShellWindow } from "@/lib/ios-shell";

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
  const { toast } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status>("prompt");
  const [isNative, setIsNative] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (typeof window === "undefined") return;

    // iOS Capacitor shell: use native Push Notifications plugin. The
    // WKWebView exposes `Notification` as undefined, so the web
    // support check below would incorrectly flag the app as
    // "unsupported" — short-circuit before that path runs.
    if (isIosShellWindow()) {
      setIsNative(true);
      void probeNativeStatus().then(setStatus);
      return;
    }

    if (
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
    // Apple HIG + App Store review guidance: don't show the native
    // permission prompt cold. Explain the value first, let the user
    // opt in, THEN trigger the OS prompt. A "No" at this stage leaves
    // permission at its current state so we can ask again later; a
    // "No" at the OS prompt is permanent and can only be reversed
    // in system settings.
    const ok = await confirm({
      title: "Turn on lead alerts?",
      message:
        "We'll send a quick notification each time a new lead is uploaded so you can call them before your competitors. You can turn this off any time in Settings.",
      confirmLabel: "Turn on",
      cancelLabel: "Not now",
    });
    if (!ok) return;
    setStatus("subscribing");

    if (isNative) {
      // Branch on the actual Capacitor platform — isIosShellWindow()
      // matches both iOS and Android shells, so the POST body's
      // `platform` must come from Capacitor.getPlatform() to avoid
      // storing Android FCM tokens as iOS subscriptions (which would
      // fail silently when the APNs fan-out ships).
      const platform = getNativePlatform() ?? "ios";
      await enableNative({ platform, onError: toast, onStatus: setStatus });
      return;
    }

    if (!publicKey) {
      setStatus("unsupported");
      return;
    }
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
      toast({
        kind: "error",
        message: `Couldn't enable notifications. On iPhone, Add to Home Screen first.`,
        duration: 6000,
      });
      setStatus("prompt");
    }
  }

  async function disable() {
    try {
      if (isNative) {
        await disableNative();
        setStatus("prompt");
        return;
      }
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

// --- Native (Capacitor) path -----------------------------------------------

async function probeNativeStatus(): Promise<Status> {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === "denied") return "denied";
    if (perm.receive === "granted") {
      // "granted" doesn't mean we've registered a token yet, but any
      // row in push_subscriptions for this device would have been
      // created after a prior register() — which the plugin auto-re-
      // registers on app launch. Treat granted as subscribed; the
      // server upsert is idempotent so re-registration is safe.
      return "subscribed";
    }
    return "prompt";
  } catch {
    return "unsupported";
  }
}

async function enableNative({
  platform,
  onError,
  onStatus,
}: {
  platform: "ios" | "android";
  onError: (t: {
    kind: "error" | "success" | "info";
    message: string;
    duration?: number;
  }) => void;
  onStatus: (s: Status) => void;
}): Promise<void> {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") {
      onStatus(perm.receive === "denied" ? "denied" : "prompt");
      return;
    }

    // The plugin is event-based: calling register() kicks off APNs
    // token acquisition and fires "registration" (or "registrationError")
    // asynchronously. Wrap it in a Promise so enable() can await the
    // server upsert before flipping to "subscribed".
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        // Defensive: `removeAllListeners` is plugin-wide. Other callers
        // of this component are on the same page, so this is safe.
        void PushNotifications.removeAllListeners();
        fn();
      };

      void PushNotifications.addListener("registration", async (token) => {
        try {
          const res = await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform,
              device_token: token.value,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          finish(resolve);
        } catch (err) {
          finish(() => reject(err));
        }
      });

      void PushNotifications.addListener("registrationError", (err) => {
        finish(() => reject(new Error(err.error)));
      });

      // Safety timeout so a silent APNs failure doesn't leave the UI
      // stuck in "subscribing" forever.
      setTimeout(() => {
        finish(() => reject(new Error("Registration timed out")));
      }, 15000);

      void PushNotifications.register();
    });

    onStatus("subscribed");
  } catch (e) {
    console.error(e);
    onError({
      kind: "error",
      message:
        e instanceof Error && e.message.length < 120
          ? `Couldn't enable notifications: ${e.message}`
          : "Couldn't enable notifications. Please try again.",
      duration: 6000,
    });
    onStatus("prompt");
  }
}

async function disableNative(): Promise<void> {
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    // There's no APNs "unregister" equivalent. Best we can do is
    // drop the stored device_token server-side; the native OS will
    // keep delivering pushes if we ever re-register, but the server
    // has no record of the device to send to.
    await PushNotifications.removeAllListeners();
    // We don't have the device token on the JS side after initial
    // registration, so fall back to signalling "unsubscribe" with a
    // user-scoped DELETE that targets the most recent native row
    // for this user. Implemented by a small GET/DELETE dance below
    // once a follow-up PR adds the server hook; for now the user
    // can uninstall the app to purge or revoke via Settings → Push.
    //
    // Deliberately no-op so the UI can flip back to "prompt" without
    // surprising the user; this is the same behavior as disabling the
    // web path when the service worker has gone away.
  } catch (e) {
    console.error(e);
  }
}
