/**
 * Lazy-loads the Google Maps JavaScript API on demand.
 *
 * We intentionally avoid adding @googlemaps/js-api-loader — the loader is
 * two lines and dropping the dep keeps the client bundle smaller. The
 * returned promise resolves once `window.google.maps` is available.
 *
 * The browser-side key is a separate, HTTP-referrer restricted key from the
 * server-side GOOGLE_MAPS_API_KEY (which is used by Distance Matrix + Geocoding
 * under the service role). Keeping them separate lets us lock each key down
 * to only the surfaces that need it.
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
  if (window.google?.maps) {
    return Promise.resolve(window.google);
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
    const script = document.createElement("script");
    // `libraries=routes` enables DirectionsService; `loading=async` is the
    // Google-recommended flag to silence the loader warning in Chrome.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      key
    )}&v=weekly&libraries=routes&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google);
      } else {
        reject(new Error("Google Maps script loaded but window.google.maps is missing."));
      }
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps script."));
    document.head.appendChild(script);
  });
  return window.__googleMapsLoader;
}
