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
 * Records a hit against `key` and returns whether the caller may
 * proceed. Sliding window: a request is allowed only if fewer than
 * `limit` hits occurred within the preceding `windowMs` milliseconds.
 */
export function checkRateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const cutoff = now - windowMs;

  const existing = BUCKETS.get(key);
  const retained = existing
    ? existing.timestamps.filter((t) => t > cutoff)
    : [];

  if (retained.length >= limit) {
    // Earliest retained timestamp is when the window will next have capacity.
    const earliest = retained[0];
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

  retained.push(now);
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
