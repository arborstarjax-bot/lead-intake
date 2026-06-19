import { NextRequest, NextResponse } from "next/server";
import { ingestText, checkRateLimit, rateLimitKey, refundRateLimit } from "@/modules/ingest/server";
import { sendNewLeadPush } from "@/lib/push";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";
import { PRICING, getBillingState } from "@/modules/billing/server";
import { getSettings } from "@/lib/settings";
import type { Lead } from "@/modules/leads/model";
import type { DuplicateMatch } from "@/modules/leads";

export const runtime = "nodejs";
export const maxDuration = 60;

const INGEST_LIMIT_PER_DAY = PRICING.starter.uploadsPerDay;
const INGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Billing gate (same as image ingest)
  const billing = await getBillingState(auth.workspaceId);
  if (!billing.canUsePaidFeatures) {
    return NextResponse.json(
      {
        error:
          billing.plan === "trial"
            ? "Your free trial has ended. Subscribe to keep using LeadFlow."
            : "Your subscription has lapsed. Update your billing to keep uploading.",
        reason: "subscription_required",
        plan: billing.plan,
        status: billing.subscriptionStatus,
      },
      { status: 402 }
    );
  }

  let reservedCount = 0;

  if (!billing.unlimitedUploads) {
    const rlKey = rateLimitKey(["ingest", auth.workspaceId]);
    const limit = checkRateLimit({
      key: rlKey,
      limit: INGEST_LIMIT_PER_DAY,
      windowMs: INGEST_WINDOW_MS,
      cost: 1,
    });
    if (!limit.ok) {
      const hours = Math.ceil((limit.retryAfterSeconds ?? 0) / 3600);
      return NextResponse.json(
        {
          error: `Daily upload limit reached (${INGEST_LIMIT_PER_DAY}/day on Starter). Try again in ~${hours}h or upgrade to Pro for unlimited uploads.`,
          reason: "plan_cap",
          plan: billing.plan,
          limit: INGEST_LIMIT_PER_DAY,
          retryAfterSeconds: limit.retryAfterSeconds ?? null,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(limit.retryAfterSeconds),
            "X-RateLimit-Limit": String(limit.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const { data: rlRows, error: rlErr } = await admin.rpc("reserve_ingest_quota", {
      ws: auth.workspaceId,
      n: 1,
      max_per_day: INGEST_LIMIT_PER_DAY,
    });
    if (rlErr) {
      console.warn("[ingest/text] reserve_ingest_quota RPC failed, falling back to in-memory limit:", rlErr.message);
    } else {
      const row = Array.isArray(rlRows) ? rlRows[0] : rlRows;
      const used = Number(row?.used ?? 0);
      const remaining = Number(row?.remaining ?? 0);
      if (!row?.ok) {
        refundRateLimit({ key: rlKey, cost: 1 });
        return NextResponse.json(
          {
            error:
              remaining === 0
                ? `Daily upload limit reached (${INGEST_LIMIT_PER_DAY}/day on Starter). Try again tomorrow or upgrade to Pro for unlimited uploads.`
                : `Only ${remaining} upload${remaining === 1 ? "" : "s"} remaining today. Upgrade to Pro for unlimited.`,
            reason: "plan_cap",
            plan: billing.plan,
            limit: INGEST_LIMIT_PER_DAY,
            used,
            remaining,
          },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": String(INGEST_LIMIT_PER_DAY),
              "X-RateLimit-Remaining": String(remaining),
            },
          }
        );
      }
    }
    reservedCount = 1;
  }

  const settings = await getSettings(auth.workspaceId);
  const fallbackSalesperson = settings.default_salesperson || null;

  let result: {
    lead_id: string;
    intake_status: string;
    duplicates: DuplicateMatch[];
    lead?: Lead;
  };

  try {
    const res = await ingestText({
      workspaceId: auth.workspaceId,
      text,
      defaultSalesperson: fallbackSalesperson,
    });
    result = res;
  } catch (e) {
    // Refund reserved quota on failure
    if (reservedCount > 0) {
      try {
        await admin.rpc("refund_ingest_quota", {
          ws: auth.workspaceId,
          n: 1,
        });
      } catch {
        // Best-effort
      }
    }
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }

  // Attach the full lead record
  try {
    const { data: createdLead } = await admin
      .from("leads")
      .select("*")
      .eq("workspace_id", auth.workspaceId)
      .eq("id", result.lead_id)
      .single();
    if (createdLead) {
      result.lead = createdLead as Lead;
    }
  } catch {
    // Non-fatal
  }

  try {
    const lead = result.lead;
    const latestLead = lead
      ? { client: lead.client, phone_number: lead.phone_number }
      : null;
    await sendNewLeadPush({ workspaceId: auth.workspaceId, latestLead });
  } catch {
    // Push is best-effort
  }

  return NextResponse.json({ result });
}
