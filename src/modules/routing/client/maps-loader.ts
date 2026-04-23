/**
 * Lazy-loads the Google Maps JavaScript API on demand, using Google's
 * official inline bootstrap snippet. That snippet installs
 * `google.maps.importLibrary` *before* the network request for the maps
 * script starts, which guarantees `importLibrary` is always callable —
 * regardless of CDN caching, script-load race conditions, or the API key
 * being rejected.
 *
 * The browser-side key is a separate, HTTP-referrer-restricted key from
 * the server-side GOOGLE_MAPS_API_KEY (used by Distance Matrix + Geocoding
 * under the service role). Keeping them separate lets us lock each key
 * down to only the surfaces that need it.
 *
 * Snippet reference:
 * https://developers.google.com/maps/documentation/javascript/load-maps-js-api#dynamic-library-import
 */

type GoogleMapsNamespace = typeof google;

declare global {
  interface Window {
    __googleMapsLoader?: Promise<GoogleMapsNamespace>;
    // Google invokes this as `window.gm_authFailure` when the API key is
    // rejected (bad key, referrer restriction fails, billing off, etc).
    // Setting it is the ONLY way to observe those failures — Google does
    // not propagate them through a Promise rejection.
    gm_authFailure?: () => void;
    __googleMapsAuthError?: string | null;
  }
}

/**
 * Hook Google's auth-failure callback. Without this, a rejected key fails
 * silently (white map container, no console error useful to end-users).
 * We record the failure on `window.__googleMapsAuthError` so the UI can
 * surface it alongside our own loader errors.
 */
function installAuthFailureHook(): void {
  if (typeof window === "undefined") return;
  if (window.gm_authFailure) return;
  window.gm_authFailure = () => {
    window.__googleMapsAuthError =
      "Google rejected the Maps API key. Most often on iPhone this means the key's HTTP-referrer restriction doesn't match this origin, or billing/Maps JS API isn't enabled on the Google Cloud project.";
    // Broadcast so any mounted RouteMap can flip into an error state
    // without requiring a reload.
    window.dispatchEvent(new Event("googleMapsAuthFailure"));
  };
}

/**
 * Inline bootstrap — adapted from Google's recommended loader. This sets up
 * `google.maps.importLibrary` synchronously and defers the actual <script>
 * fetch until the first `importLibrary()` call.
 */
function installInlineBootstrap(apiKey: string): void {
  // Already installed (e.g. after hot-reload in dev or a prior mount).
  if (typeof window.google?.maps?.importLibrary === "function") return;

  const params = { key: apiKey, v: "weekly" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = window as any;
  g.google = g.google || {};
  g.google.maps = g.google.maps || {};
  const maps = g.google.maps;
  const pending = new Set<string>();
  let scriptPromise: Promise<void> | null = null;

  const loadScript = (): Promise<void> => {
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise<void>((resolve, reject) => {
      const usp = new URLSearchParams();
      usp.set("libraries", Array.from(pending).join(","));
      for (const [k, v] of Object.entries(params)) {
        usp.set(k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), String(v));
      }
      usp.set("callback", "google.maps.__ib__");
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?" + usp.toString();
      script.async = true;
      script.defer = true;
      script.onerror = () =>
        reject(new Error("Google Maps JS API failed to load."));
      maps.__ib__ = () => resolve();
      document.head.appendChild(script);
    });
    return scriptPromise;
  };

  maps.importLibrary = (name: string, ...rest: unknown[]): Promise<unknown> => {
    pending.add(name);
    return loadScript().then(() => maps.importLibrary(name, ...rest));
  };
}

export function loadGoogleMaps(): Promise<GoogleMapsNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadGoogleMaps must run in the browser."));
  }
  if (window.__googleMapsLoader) {
    return window.__googleMapsLoader;
  }

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) {
    return Promise.reject(
      new Error(
        "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is not set. Add it on Vercel and redeploy."
      )
    );
  }

  window.__googleMapsLoader = (async () => {
    installAuthFailureHook();
    installInlineBootstrap(key);
    // Hydrate the library classes onto `google.maps` so callers can use
    // `new google.maps.Map(...)`, `new google.maps.Marker(...)`, and
    // `new google.maps.DirectionsService()` synchronously after this
    // promise resolves.
    await Promise.all([
      window.google.maps.importLibrary("maps"),
      window.google.maps.importLibrary("marker"),
      window.google.maps.importLibrary("routes"),
    ]);
    return window.google;
  })();
  return window.__googleMapsLoader;
}
