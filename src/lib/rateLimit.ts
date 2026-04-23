/**
 * In-memory sliding-window rate limiter for API routes.
 *
 * Scope: a single Node.js process. This is fine for a small SaaS on
 * Vercel — serverless instances stay warm per region and concurrent
 * abuse from the same user typically hits the same instance. If you
 * outgrow this, swap in an external store (Upstash Redis / Supabase
 * rate-limit) without changing the call site.
 *
 * Intent: protect expensive operations (OpenAI calls, outbound email,
 * push) from runaway usage by an authenticated user.
 */

type Bucket = {
  /** Unix ms of the earliest retained timestamp. */
  timestamps: number[];
};

const BUCKETS = new Map<string, Bucket>();

/** Occasional cleanup so expired keys don't grow memory forever. */
function sweep(now: number) {
  if (BUCKETS.size < 1024) return;
  for (const [key, bucket] of BUCKETS) {
    if (!bucket.timestamps.length || bucket.timestamps[bucket.timestamps.length - 1] < now - 24 * 60 * 60 * 1000) {
      BUCKETS.delete(key);
    }
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number; limit: number; resetAt: number }
  | { ok: false; remaining: 0; limit: number; retryAfterSeconds: number; resetAt: number };

/**
 * Records `cost` hits against `key` and returns whether the caller may
 * proceed. Sliding window: the request is allowed only if the count of
 * hits in the preceding `windowMs` milliseconds PLUS `cost` stays at or
 * below `limit`. When rejected, no hits are recorded.
 *
 * `cost` lets a single request consume multiple slots — e.g. a batch
 * upload of N files where each file is itself expensive.
 */
export function checkRateLimit({
  key,
  limit,
  windowMs,
  cost = 1,
}: {
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
}): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const cutoff = now - windowMs;
  const effectiveCost = Math.max(1, Math.floor(cost));

  const existing = BUCKETS.get(key);
  const retained = existing
    ? existing.timestamps.filter((t) => t > cutoff)
    : [];

  if (retained.length + effectiveCost > limit) {
    // Earliest retained timestamp is when the window will next have capacity.
    const earliest = retained[0] ?? now;
    const resetAt = earliest + windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
    BUCKETS.set(key, { timestamps: retained });
    return {
      ok: false,
      remaining: 0,
      limit,
      retryAfterSeconds,
      resetAt,
    };
  }

  for (let i = 0; i < effectiveCost; i += 1) retained.push(now);
  BUCKETS.set(key, { timestamps: retained });
  return {
    ok: true,
    remaining: Math.max(0, limit - retained.length),
    limit,
    resetAt: now + windowMs,
  };
}

/** Convenience wrapper for (workspace, user, action) triples. */
export function rateLimitKey(parts: (string | null | undefined)[]): string {
  return parts.map((p) => p ?? "_").join(":");
}

/**
 * Undo the most-recent `cost` hits previously recorded against `key`.
 *
 * Intended for two-stage rate checks: an API route may pass an
 * in-memory limit but fail a subsequent authoritative check (e.g. a
 * DB-backed quota). Without a refund, those slots stay "consumed" for
 * a request the server never actually served, eventually starving the
 * legitimate caller out of their real quota.
 *
 * Removes timestamps from the tail of the bucket — `checkRateLimit`
 * pushes to the tail on accept, so refunding from the tail precisely
 * reverses the last accepted call.
 */
export function refundRateLimit({
  key,
  cost = 1,
}: {
  key: string;
  cost?: number;
}): void {
  const bucket = BUCKETS.get(key);
  if (!bucket) return;
  const n = Math.max(1, Math.floor(cost));
  bucket.timestamps.splice(-n);
  if (bucket.timestamps.length === 0) BUCKETS.delete(key);
  else BUCKETS.set(key, bucket);
}
