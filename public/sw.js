// Minimal service worker — just enough for installability, offline-aware
// shell, Web Push notifications, and app-icon badges. We intentionally do
// NOT pre-cache HTML routes because the leads table must always show fresh
// data; stale SSR HTML would silently hide newly-uploaded leads. Runtime
// caching is limited to static assets.

const STATIC_CACHE = "leadflow-static-v4";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // Cache-first for explicit static assets; network-first for everything else.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    STATIC_ASSETS.includes(url.pathname) ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
            return res;
          })
      )
    );
  }
});

// --- Web Push ---------------------------------------------------------------
// On iOS 16.4+ PWAs, a notification MUST be shown for every push event or
// the browser will eventually revoke the subscription. We also set the app
// icon badge count when the payload includes one.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "New lead", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "New lead";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "leadflow",
    data: { url: payload.url || "/leads" },
    renotify: true,
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      typeof payload.badgeCount === "number" && "setAppBadge" in self.navigator
        ? self.navigator.setAppBadge(payload.badgeCount).catch(() => {})
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/leads";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        try {
          const u = new URL(client.url);
          if (u.pathname === url || u.pathname.startsWith(url)) {
            if ("focus" in client) return client.focus();
          }
        } catch {}
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
