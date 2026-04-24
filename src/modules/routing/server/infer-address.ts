import "server-only";
import { requireEnv } from "@/lib/utils";
import { MapsUnavailableError } from "./maps";

/**
 * Address intelligence: given whatever partial address fields the user
 * has entered so far (street, city, state, zip), ask Google's Geocoding
 * API to normalize the full address and return the canonical component
 * values plus a confidence score.
 *
 * This is distinct from ./geocode.ts (which only cares about lat/lng).
 * Geocoding already resolves administrative components as a byproduct
 * of lat/lng lookup, so we reuse the same HTTP endpoint but parse out
 * the `address_components` array the other caller throws away.
 *
 * Confidence is derived from Google's `geometry.location_type` plus the
 * `partial_match` flag — the two fields Google documents as
 * reliability signals for the match. We avoid rolling our own fuzzy
 * string comparison so the number the user sees is anchored to
 * something Google actually guarantees.
 */

type AddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type GeocodeResult = {
  formatted_address: string;
  partial_match?: boolean;
  address_components: AddressComponent[];
  geometry: {
    location_type:
      | "ROOFTOP"
      | "RANGE_INTERPOLATED"
      | "GEOMETRIC_CENTER"
      | "APPROXIMATE";
  };
};

type GeocodeResponse = {
  status: string;
  error_message?: string;
  results: GeocodeResult[];
};

export type AddressParts = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type InferredAddress = {
  /** Fully normalized address parts. null means Google couldn't resolve
   *  a component even though the overall query returned a result. */
  parts: AddressParts;
  /** Google's formatted address string — useful as a `title=` tooltip. */
  formatted: string;
  /** 0..1 confidence score. See `scoreConfidence` for the rubric. */
  confidence: number;
  /** Raw location_type for debugging / display. */
  locationType: GeocodeResult["geometry"]["location_type"];
  /** Whether Google flagged this as a partial match (i.e. had to guess
   *  some components). Surface in the UI so the user knows to double-check. */
  partialMatch: boolean;
};

/**
 * Decide what input string to send to Google. A full street + city + zip
 * works best; we gracefully degrade when the user has entered fewer
 * pieces. Returning an empty string short-circuits callers — "blah"
 * alone isn't worth a Geocoding call.
 */
export function buildInferenceQuery(parts: AddressParts): string {
  const segs = [
    parts.address?.trim(),
    parts.city?.trim(),
    parts.state?.trim(),
    parts.zip?.trim(),
  ].filter((s): s is string => Boolean(s));
  // Need at least a street address OR a zip to anchor the lookup. A
  // bare city/state combo produces huge regional geometry that's
  // useless for auto-filling a specific property's missing fields.
  const hasAnchor = Boolean(parts.address?.trim()) || Boolean(parts.zip?.trim());
  if (!hasAnchor) return "";
  if (segs.length < 2) return "";
  return segs.join(", ");
}

/** Map Google's location_type + partial_match → a 0..1 confidence score.
 *  The buckets are coarse on purpose — the UI rounds to whole percent,
 *  so a 0.95 vs 0.97 distinction would be meaningless to the user. */
function scoreConfidence(result: GeocodeResult): number {
  let base: number;
  switch (result.geometry.location_type) {
    case "ROOFTOP":
      base = 0.97;
      break;
    case "RANGE_INTERPOLATED":
      base = 0.9;
      break;
    case "GEOMETRIC_CENTER":
      base = 0.75;
      break;
    case "APPROXIMATE":
      base = 0.6;
      break;
    default:
      base = 0.5;
  }
  if (result.partial_match) base = Math.max(0.4, base - 0.2);
  return base;
}

function pickComponent(
  comps: AddressComponent[],
  type: string,
  useShort = false
): string | null {
  const c = comps.find((c) => c.types.includes(type));
  if (!c) return null;
  return useShort ? c.short_name : c.long_name;
}

/**
 * Pull normalized address parts out of a Google result. Street number
 * and route are concatenated into a single line since that's how the
 * lead model stores `address`.
 */
function extractParts(result: GeocodeResult): AddressParts {
  const comps = result.address_components;
  const streetNumber = pickComponent(comps, "street_number");
  const route = pickComponent(comps, "route");
  const address =
    streetNumber && route
      ? `${streetNumber} ${route}`
      : route || streetNumber || null;
  const city =
    pickComponent(comps, "locality") ||
    pickComponent(comps, "postal_town") ||
    // Some unincorporated areas only have sublocality / neighborhood.
    pickComponent(comps, "sublocality") ||
    pickComponent(comps, "sublocality_level_1") ||
    null;
  const state = pickComponent(comps, "administrative_area_level_1", true);
  const zip = pickComponent(comps, "postal_code");
  return { address, city, state, zip };
}

/**
 * Resolve a partial address into its normalized components using the
 * Google Geocoding API. Returns null when the input is too sparse
 * (e.g. only a state entered) or Google can't find a plausible match.
 */
export async function inferAddress(
  input: AddressParts
): Promise<InferredAddress | null> {
  const query = buildInferenceQuery(input);
  if (!query) return null;

  const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");
  // Bias the search to the United States — this app's customers are US
  // arborists; without a country hint Google occasionally resolves
  // ambiguous zip-like strings in other locales.
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}` +
    `&components=country:US&key=${apiKey}`;

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
  const top = body.results[0];
  if (!top) return null;
  return {
    parts: extractParts(top),
    formatted: top.formatted_address,
    confidence: scoreConfidence(top),
    locationType: top.geometry.location_type,
    partialMatch: Boolean(top.partial_match),
  };
}
