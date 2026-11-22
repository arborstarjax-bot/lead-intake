import "server-only";
import { createAdminClient } from "@/modules/shared/supabase/server";

/**
 * Persistent memo for Distance Matrix answers, backed by `drive_time_cache`.
 * Ported from ArborCore's routing/drive-cache.service.
 *
 * Distance Matrix is billed per element, and the same legs were priced again
 * on every route load, every slot rank and every optimize pass — the
 * per-request memo only spared duplicates inside one API call. Two addresses
 * keep their drive time for weeks, so the answer is worth keeping between
 * requests.
 *
 * A traffic-aware lookup (one that passed a departure time) is kept per
 * weekday/hour bucket, because rush hour is the thing it was asked about; a
 * plain lookup is kept once. Cache trouble is never fatal: a failed read or
 * write just means the caller pays Google for that pair as before.
 */

const STATIC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TRAFFIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CachedDrive = { driveSeconds: number; distanceMeters: number };

function bucket(departureEpochSeconds?: number): string {
  if (!departureEpochSeconds) return "static";
  const at = new Date(departureEpochSeconds * 1000);
  return `t${at.getUTCDay()}-${at.getUTCHours()}`;
}

export function driveCacheKey(
  origin: string,
  destination: string,
  departureEpochSeconds?: number
): string {
  return `${origin.trim()}=>${destination.trim()}|${bucket(departureEpochSeconds)}`;
}

function freshEnough(key: string, updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const age = Date.now() - new Date(updatedAt).getTime();
  if (Number.isNaN(age)) return false;
  return age < (key.endsWith("|static") ? STATIC_TTL_MS : TRAFFIC_TTL_MS);
}

/** Cached legs by key. Keys the cache has no fresh answer for are absent. */
export async function readDriveCache(keys: string[]): Promise<Map<string, CachedDrive>> {
  const out = new Map<string, CachedDrive>();
  if (keys.length === 0) return out;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("drive_time_cache")
      .select("cache_key, drive_seconds, distance_meters, updated_at")
      .in("cache_key", Array.from(new Set(keys)));
    if (error || !data) return out;
    for (const row of data) {
      const key = String(row.cache_key);
      if (!freshEnough(key, row.updated_at as string | null)) continue;
      out.set(key, {
        driveSeconds: Number(row.drive_seconds),
        distanceMeters: Number(row.distance_meters),
      });
    }
  } catch {
    // No cache table yet, or the read failed — pay Google instead.
  }
  return out;
}

export async function writeDriveCache(
  entries: Array<{ key: string; leg: CachedDrive }>
): Promise<void> {
  if (entries.length === 0) return;
  try {
    // Two stops can share an address, so a batch can carry the same key
    // twice — Postgres rejects the whole upsert then; keep the last copy.
    const dedup = new Map<string, { driveSeconds: number; distanceMeters: number }>();
    for (const { key, leg } of entries) dedup.set(key, leg);
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    await supabase.from("drive_time_cache").upsert(
      Array.from(dedup, ([key, leg]) => ({
        cache_key: key,
        drive_seconds: Math.round(leg.driveSeconds),
        distance_meters: Math.round(leg.distanceMeters),
        updated_at: now,
      })),
      { onConflict: "cache_key" }
    );
  } catch {
    // Writing the memo is an optimization, never a reason to fail a route.
  }
}
