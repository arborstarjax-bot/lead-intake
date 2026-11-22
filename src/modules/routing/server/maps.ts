import "server-only";
import { requireEnv } from "@/lib/utils";
import { driveCacheKey, readDriveCache, writeDriveCache } from "./drive-cache";

/**
 * Thin wrapper around the Google Maps Distance Matrix API. We use it to
 * compute drive time between a day's existing stops and a candidate slot
 * so the scheduler can rank slots that require the least driving.
 *
 * https://developers.google.com/maps/documentation/distance-matrix/start
 *
 * Pricing note: Distance Matrix is charged per element (origin * destination
 * pair). At David's volume (~10 lookups per scheduling session) this is
 * fractions of a cent per use. We still cache results in-memory for the
 * duration of a single request via `memoDriveTime`, which matters because
 * the scheduler may price multiple candidate slots against the same pair.
 */

export type DriveResult = {
  /** Seconds of driving per Google (in traffic if departure_time supplied). */
  drive_seconds: number;
  /** Meters along the fastest route. */
  distance_meters: number;
};

/** Thrown when Google returns a non-OK row status for the requested pair. */
export class MapsUnavailableError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MapsUnavailableError";
  }
}

type ApiRow = {
  elements: {
    status: string;
    duration?: { value: number };
    duration_in_traffic?: { value: number };
    distance?: { value: number };
  }[];
};
type ApiResponse = {
  status: string;
  error_message?: string;
  rows: ApiRow[];
};

/**
 * Returns the drive time between a single origin and single destination.
 * `departureEpochSeconds` opts in to duration_in_traffic for more accurate
 * morning/afternoon differences.
 */
export async function getDriveTime(
  origin: string,
  destination: string,
  departureEpochSeconds?: number
): Promise<DriveResult> {
  const [result] = await getDriveMatrix([origin], [destination], departureEpochSeconds);
  return result;
}

/**
 * Batched variant. Results are returned in row-major order (origin 0 vs
 * each destination, origin 1 vs each destination, …).
 *
 * Every element first goes through the persistent `drive_time_cache`:
 * fresh cached legs are served without billing Google, and only the
 * missing elements of each origin row are requested and then written
 * back. Cache trouble degrades to paying Google for that row, never to
 * a failure.
 */
export async function getDriveMatrix(
  origins: string[],
  destinations: string[],
  departureEpochSeconds?: number
): Promise<DriveResult[]> {
  if (origins.length === 0 || destinations.length === 0) return [];

  const out: DriveResult[] = new Array(origins.length * destinations.length);
  const cached = await readDriveCache(
    origins.flatMap((o) => destinations.map((d) => driveCacheKey(o, d, departureEpochSeconds)))
  );
  const writes: Array<{ key: string; leg: { driveSeconds: number; distanceMeters: number } }> = [];

  for (let i = 0; i < origins.length; i++) {
    const misses: number[] = [];
    for (let j = 0; j < destinations.length; j++) {
      const key = driveCacheKey(origins[i], destinations[j], departureEpochSeconds);
      const hit = cached.get(key);
      if (hit) {
        out[i * destinations.length + j] = {
          drive_seconds: hit.driveSeconds,
          distance_meters: hit.distanceMeters,
        };
      } else {
        misses.push(j);
      }
    }
    if (misses.length === 0) continue;

    const rows = await fetchDriveMatrix(
      [origins[i]],
      misses.map((j) => destinations[j]),
      departureEpochSeconds
    );
    for (let m = 0; m < misses.length; m++) {
      const j = misses[m];
      const r = rows[m];
      out[i * destinations.length + j] = r;
      writes.push({
        key: driveCacheKey(origins[i], destinations[j], departureEpochSeconds),
        leg: { driveSeconds: r.drive_seconds, distanceMeters: r.distance_meters },
      });
    }
  }

  await writeDriveCache(writes);
  return out;
}

/**
 * One billed Google Distance Matrix call; results in row-major order.
 * Callers should go through `getDriveMatrix` for caching.
 */
async function fetchDriveMatrix(
  origins: string[],
  destinations: string[],
  departureEpochSeconds?: number
): Promise<DriveResult[]> {
  const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");
  const params = new URLSearchParams({
    origins: origins.join("|"),
    destinations: destinations.join("|"),
    mode: "driving",
    units: "imperial",
    key: apiKey,
  });
  if (departureEpochSeconds) {
    // "now" also works; passing a specific future timestamp lets us predict
    // morning vs afternoon traffic when ranking slots.
    params.set("departure_time", String(Math.max(departureEpochSeconds, Math.floor(Date.now() / 1000))));
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new MapsUnavailableError(
      `Distance Matrix HTTP ${res.status}`,
      `HTTP_${res.status}`
    );
  }
  const body = (await res.json()) as ApiResponse;
  if (body.status !== "OK") {
    throw new MapsUnavailableError(
      body.error_message ?? `Distance Matrix status ${body.status}`,
      body.status
    );
  }

  const out: DriveResult[] = [];
  for (const row of body.rows) {
    for (const el of row.elements) {
      if (el.status !== "OK" || !el.duration) {
        throw new MapsUnavailableError(
          `Distance Matrix row status ${el.status}`,
          el.status
        );
      }
      const seconds = el.duration_in_traffic?.value ?? el.duration.value;
      out.push({
        drive_seconds: seconds,
        distance_meters: el.distance?.value ?? 0,
      });
    }
  }
  return out;
}

/**
 * Per-request memoization. The scheduler may compute the same pair multiple
 * times while ranking candidate slots; using a single map avoids duplicate
 * network calls within one /api/schedule/suggest invocation.
 */
export function createDriveMemo() {
  const cache = new Map<string, Promise<DriveResult>>();
  const key = (o: string, d: string, t?: number) => `${o}|${d}|${t ?? ""}`;
  return async function drive(origin: string, destination: string, departureEpochSeconds?: number) {
    const k = key(origin, destination, departureEpochSeconds);
    const existing = cache.get(k);
    if (existing) return existing;
    const p = getDriveTime(origin, destination, departureEpochSeconds);
    cache.set(k, p);
    return p;
  };
}
