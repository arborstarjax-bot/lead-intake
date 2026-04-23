import { NextRequest, NextResponse } from "next/server";
import { ingestScreenshot } from "@/lib/ingest";
import { maybeConvertHeic } from "@/lib/convert-heic";
import { sendNewLeadPush } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { PRICING, getBillingState, getUploadsInLastDay } from "@/lib/billing";
import { getSettings } from "@/lib/settings";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Per-workspace ingest cap on the Starter tier. Each screenshot triggers a
// GPT-4o vision call, which is the most expensive operation in the app.
// Pro tier is unlimited; the cap is skipped when plan === 'pro'.
const INGEST_LIMIT_PER_DAY = PRICING.starter.uploadsPerDay;
const INGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Billing gate. Blocks lapsed Starter/Pro workspaces (past_due,
  // canceled), plan='free', and expired trials BEFORE they can burn an
  // OpenAI call. getBillingState is the single source of truth —
  // canUsePaidFeatures mirrors the same gate used by /billing UI, and
  // unlimitedUploads requires plan='pro' AND an active/trialing
  // subscription, which closes the lapsed-Pro bypass.
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

  if (!billing.unlimitedUploads) {
    // Count each uploaded file as a separate hit: a batch of 10 screenshots
    // burns 10 OpenAI calls even though it's one request. Keyed by workspace
    // (not user) because the Starter plan sells a workspace-level quota — a
    // five-person team shares the same daily bucket.
    //
    // Two layers of rate limiting, in order:
    //   1. In-memory sliding window (fast pre-filter, per Vercel instance).
    //      Handles runaway retries from a single warm instance without
    //      touching the DB.
    //   2. DB-backed count on the `leads` table (authoritative).
    //      Required because the in-memory limiter is per-process — two
    //      Vercel instances handling concurrent requests can each grant
    //      up to 50 uploads, doubling real consumption. `getUploadsInLastDay`
    //      is the same source of truth used by the /billing meter.
    const limit = checkRateLimit({
      key: rateLimitKey(["ingest", auth.workspaceId]),
      limit: INGEST_LIMIT_PER_DAY,
      windowMs: INGEST_WINDOW_MS,
      cost: files.length,
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

    // DB-backed authoritative check. Counts `intake_source='web_upload'`
    // rows in the last 24h for this workspace. If the combined count
    // (existing + this batch) would exceed the cap, reject. Accepts the
    // first upload that *crosses* the cap as a 1-file edge (e.g. user
    // at 49 uploads 1 file → ok; uploads 2 files → refuse).
    const usedToday = await getUploadsInLastDay(auth.workspaceId);
    if (usedToday + files.length > INGEST_LIMIT_PER_DAY) {
      const remaining = Math.max(0, INGEST_LIMIT_PER_DAY - usedToday);
      return NextResponse.json(
        {
          error:
            remaining === 0
              ? `Daily upload limit reached (${INGEST_LIMIT_PER_DAY}/day on Starter). Try again tomorrow or upgrade to Pro for unlimited uploads.`
              : `Only ${remaining} upload${remaining === 1 ? "" : "s"} remaining today. Trying to upload ${files.length} — retry with ${remaining} or fewer, or upgrade to Pro for unlimited.`,
          reason: "plan_cap",
          plan: billing.plan,
          limit: INGEST_LIMIT_PER_DAY,
          used: usedToday,
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

  const results: Array<{
    fileName: string;
    originalFileName: string;
    lead_id: string;
    intake_status: string;
    duplicates: unknown[];
    lead?: Lead;
  }> = [];
  const errors: Array<{ fileName: string; error: string }> = [];

  // `sales_person` is rendered into customer-facing SMS/email templates
  // via the {salesPerson} placeholder — default it to the workspace's
  // configured display name, never the creator's email.
  // Use `||` (not `??`) so an empty-string default_salesperson falls
  // through to null; otherwise we'd write "" into sales_person and the
  // template fallback chain (which keys off truthiness) would miss it.
  // Keeps ingest consistent with the POST /api/leads truthiness check.
  const settings = await getSettings(auth.workspaceId);
  const fallbackSalesperson = settings.default_salesperson || null;

  for (const file of files) {
    try {
      const { blob, fileName } = await maybeConvertHeic(file, file.name);
      const res = await ingestScreenshot({
        workspaceId: auth.workspaceId,
        file: blob,
        fileName,
        source: "web_upload",
        defaultSalesperson: fallbackSalesperson,
      });
      results.push({ fileName, originalFileName: file.name, ...res });
    } catch (e) {
      errors.push({ fileName: file.name, error: (e as Error).message });
    }
  }

  if (results.length > 0) {
    // Attach the full lead record to each successful result so the client
    // can render the same LeadCard used on /leads without a round-trip.
    try {
      const { data: createdLeads } = await admin
        .from("leads")
        .select("*")
        .eq("workspace_id", auth.workspaceId)
        .in(
          "id",
          results.map((r) => r.lead_id)
        );
      if (createdLeads) {
        const byId = new Map((createdLeads as Lead[]).map((l) => [l.id, l]));
        for (const r of results) {
          const lead = byId.get(r.lead_id);
          if (lead) r.lead = lead;
        }
      }
    } catch {
      // Non-fatal: client still has lead_id and can refetch if needed.
    }
    try {
      const latest = results[results.length - 1]?.lead;
      const latestLead = latest
        ? { client: latest.client, phone_number: latest.phone_number }
        : null;
      await sendNewLeadPush({ workspaceId: auth.workspaceId, latestLead });
    } catch {
      // Push is best-effort; never fail the upload response over it.
    }
  }

  return NextResponse.json({ results, errors });
}
