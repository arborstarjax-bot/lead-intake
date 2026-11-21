import "server-only";
import { checkRateLimit, rateLimitKey, refundRateLimit } from "./rateLimit";
import { PRICING, getBillingState } from "@/modules/billing/server";

/**
 * Shared ingest gate used by /api/ingest, /api/ingest/text, and
 * /api/v1/ingest. Checks billing status, then the Starter daily quota
 * (in-memory pre-filter + atomic reserve_ingest_quota RPC).
 *
 * Returns null when the caller may proceed — the caller has `n` quota
 * slots reserved and must call refundIngestQuota() for slots that
 * didn't produce a lead. Returns { status, body } for a rejection.
 */

const INGEST_LIMIT_PER_DAY = PRICING.starter.uploadsPerDay;
const INGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export type QuotaResult =
  | { ok: true; reserved: number; refund: (n: number) => Promise<void> }
  | { ok: false; status: number; body: Record<string, unknown>; headers?: Record<string, string> };

export async function checkIngestQuota(workspaceId: string, n: number): Promise<QuotaResult> {
  const billing = await getBillingState(workspaceId);
  if (!billing.canUsePaidFeatures) {
    return {
      ok: false,
      status: 402,
      body: {
        error:
          billing.plan === "trial"
            ? "Your free trial has ended. Subscribe to keep using LeadFlow."
            : "Your subscription has lapsed. Update your billing to keep uploading.",
        reason: "subscription_required",
        plan: billing.plan,
        status: billing.subscriptionStatus,
      },
    };
  }

  if (billing.unlimitedUploads) {
    return { ok: true, reserved: 0, refund: async () => {} };
  }

  const rlKey = rateLimitKey(["ingest", workspaceId]);
  const limit = checkRateLimit({
    key: rlKey,
    limit: INGEST_LIMIT_PER_DAY,
    windowMs: INGEST_WINDOW_MS,
    cost: n,
  });
  if (!limit.ok) {
    const hours = Math.ceil((limit.retryAfterSeconds ?? 0) / 3600);
    return {
      ok: false,
      status: 429,
      body: {
        error: `Daily upload limit reached (${INGEST_LIMIT_PER_DAY}/day on Starter). Try again in ~${hours}h or upgrade to Pro for unlimited uploads.`,
        reason: "plan_cap",
        plan: billing.plan,
        limit: INGEST_LIMIT_PER_DAY,
        retryAfterSeconds: limit.retryAfterSeconds ?? null,
      },
      headers: {
        "Retry-After": String(limit.retryAfterSeconds),
        "X-RateLimit-Limit": String(limit.limit),
        "X-RateLimit-Remaining": "0",
      },
    };
  }

  // Atomic reservation. Postgres increments the counter iff the new
  // total stays under the cap; cross-instance races can't both succeed.
  const { createAdminClient } = await import("@/modules/shared/supabase/server");
  const admin = createAdminClient();
  const { data: rlRows, error: rlErr } = await admin.rpc("reserve_ingest_quota", {
    ws: workspaceId,
    n,
    max_per_day: INGEST_LIMIT_PER_DAY,
  });
  if (rlErr) {
    // DB rate limiter unavailable — fall back to the in-memory limit
    // that already passed rather than blocking entirely.
    console.warn("[ingest] reserve_ingest_quota RPC failed, falling back to in-memory limit:", rlErr.message);
  } else {
    const row = Array.isArray(rlRows) ? rlRows[0] : rlRows;
    const used = Number(row?.used ?? 0);
    const remaining = Number(row?.remaining ?? 0);
    if (!row?.ok) {
      refundRateLimit({ key: rlKey, cost: n });
      return {
        ok: false,
        status: 429,
        body: {
          error:
            remaining === 0
              ? `Daily upload limit reached (${INGEST_LIMIT_PER_DAY}/day on Starter). Try again tomorrow or upgrade to Pro for unlimited uploads.`
              : `Only ${remaining} upload${remaining === 1 ? "" : "s"} remaining today. Trying to upload ${n} — retry with ${remaining} or fewer, or upgrade to Pro for unlimited.`,
          reason: "plan_cap",
          plan: billing.plan,
          limit: INGEST_LIMIT_PER_DAY,
          used,
          remaining,
        },
        headers: {
          "X-RateLimit-Limit": String(INGEST_LIMIT_PER_DAY),
          "X-RateLimit-Remaining": String(remaining),
        },
      };
    }
  }

  return {
    ok: true,
    reserved: n,
    refund: async (count: number) => {
      try {
        await admin.rpc("refund_ingest_quota", { ws: workspaceId, n: count });
      } catch {
        // Best-effort — a failed refund only leaks a little quota.
      }
    },
  };
}
