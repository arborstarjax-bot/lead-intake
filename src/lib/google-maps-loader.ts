/**
 * Lazy-loads the Google Maps JavaScript API on demand.
 *
 * We use Google's recommended async bootstrap (`loading=async`), which does
 * NOT populate `google.maps.Map` on script load — you have to await
 * `google.maps.importLibrary("maps")` first. We do that here so callers can
 * treat the resolved `google` namespace as fully hydrated.
 *
 * The browser-side key is a separate, HTTP-referrer-restricted key from the
 * server-side GOOGLE_MAPS_API_KEY (used by Distance Matrix + Geocoding under
 * the service role). Keeping them separate lets us lock each key down to
 * only the surfaces that need it.
 */

type GoogleMapsNamespace = typeof google;

declare global {
  interface Window {
    __googleMapsLoader?: Promise<GoogleMapsNamespace>;
  }
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

  window.__googleMapsLoader = new Promise<GoogleMapsNamespace>((resolve, reject) => {
    const finalize = async () => {
      try {
        if (!window.google?.maps?.importLibrary) {
          throw new Error(
            "Google Maps script loaded but importLibrary is missing."
          );
        }
        // Hydrate the library classes onto `google.maps` so callers can use
        // `new google.maps.Map(...)`, `new google.maps.Marker(...)`, and
        // `new google.maps.DirectionsService()` synchronously after this
        // promise resolves.
        await Promise.all([
          window.google.maps.importLibrary("maps"),
          window.google.maps.importLibrary("marker"),
          window.google.maps.importLibrary("routes"),
        ]);
        resolve(window.google);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    // If the script tag is already present (e.g. from a previous mount that
    // threw before assigning __googleMapsLoader), just wait for the global.
    if (typeof window.google?.maps?.importLibrary === "function") {
      void finalize();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      key
    )}&v=weekly&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      void finalize();
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps script."));
    document.head.appendChild(script);
  });
  return window.__googleMapsLoader;
}
