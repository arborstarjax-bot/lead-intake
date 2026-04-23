import "server-only";
import { requireEnv } from "@/lib/utils";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { MapsUnavailableError } from "./maps";

/**
 * Server-side address → lat/lng using Google Geocoding API, backed by a
 * Postgres cache. Addresses almost never move, so hitting Google every time
 * the user flips a day on the Route Map would burn calls unnecessarily.
 *
 * Pricing: Geocoding is ~$5 per 1,000 requests. Even a dozen distinct
 * Jacksonville-area leads total over months costs literal pennies, but the
 * cache still keeps repeat-day browsing free.
 */

export type LatLng = { lat: number; lng: number };

type GeocodeResponse = {
  status: string;
  error_message?: string;
  results: {
    geometry: { location: { lat: number; lng: number } };
  }[];
};

/** Returns null if the address can't be resolved; throws on network/5xx. */
export async function geocode(address: string): Promise<LatLng | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const supabase = createAdminClient();
  const { data: cached } = await supabase
    .from("geocode_cache")
    .select("lat, lng")
    .eq("address", trimmed)
    .maybeSingle();
  if (cached) return { lat: cached.lat, lng: cached.lng };

  const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    trimmed
  )}&key=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new MapsUnavailableError(`Geocoding HTTP ${res.status}`, `HTTP_${res.status}`);
  }
  const body = (await res.json()) as GeocodeResponse;
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") {
    throw new MapsUnavailableError(
      body.error_message ?? `Geocoding status ${body.status}`,
      body.status
    );
  }
  const loc = body.results[0]?.geometry?.location;
  if (!loc) return null;

  // Upsert so two concurrent requests on a cold address don't conflict.
  await supabase
    .from("geocode_cache")
    .upsert({ address: trimmed, lat: loc.lat, lng: loc.lng }, { onConflict: "address" });
  return { lat: loc.lat, lng: loc.lng };
}

/** Bulk variant — cached addresses short-circuit; misses go out in parallel. */
export async function geocodeMany(
  addresses: string[]
): Promise<Map<string, LatLng | null>> {
  const unique = Array.from(new Set(addresses.map((a) => a.trim()).filter(Boolean)));
  const out = new Map<string, LatLng | null>();
  await Promise.all(
    unique.map(async (a) => {
      try {
        out.set(a, await geocode(a));
      } catch (e) {
        // Systemic failures (bad API key, quota exceeded, HTTP 4xx/5xx)
        // must propagate so the route handler can surface a diagnostic
        // error instead of rendering every stop as "unresolvable."
        if (e instanceof MapsUnavailableError) throw e;
        // Other per-address oddities (e.g. transient network blip on a
        // single call) shouldn't kill the whole page.
        out.set(a, null);
      }
    })
  );
  return out;
}
