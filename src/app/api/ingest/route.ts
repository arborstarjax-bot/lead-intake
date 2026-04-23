import { NextRequest, NextResponse } from "next/server";
import { ingestScreenshot } from "@/lib/ingest";
import { maybeConvertHeic } from "@/lib/convert-heic";
import { sendNewLeadPush } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import { PRICING, getBillingState } from "@/lib/billing";
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

  for (const file of files) {
    try {
      const { blob, fileName } = await maybeConvertHeic(file, file.name);
      const res = await ingestScreenshot({
        workspaceId: auth.workspaceId,
        file: blob,
        fileName,
        source: "web_upload",
        defaultSalesperson: auth.email,
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
