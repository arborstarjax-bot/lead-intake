import { NextRequest, NextResponse } from "next/server";
import { ingestScreenshot } from "@/lib/ingest";
import { maybeConvertHeic } from "@/lib/convert-heic";
import { sendNewLeadPush } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { checkRateLimit, rateLimitKey } from "@/lib/rateLimit";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Per-user ingest cap: each screenshot triggers a GPT-4o vision call, which is
// the most expensive operation in the app. 60 uploads/hour is ~2× a busy day's
// real usage and still caps a runaway client loop at a bounded cost.
const INGEST_LIMIT_PER_HOUR = 60;

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  // Count each uploaded file as a separate hit: a batch of 10 screenshots
  // burns 10 OpenAI calls even though it's one request.
  const limit = checkRateLimit({
    key: rateLimitKey(["ingest", auth.workspaceId, auth.userId]),
    limit: INGEST_LIMIT_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Upload limit reached (${INGEST_LIMIT_PER_HOUR}/hour). Try again in ${limit.retryAfterSeconds}s.`,
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
      });
      results.push({ fileName, originalFileName: file.name, ...res });
    } catch (e) {
      errors.push({ fileName: file.name, error: (e as Error).message });
    }
  }

  if (results.length > 0) {
    const admin = createAdminClient();
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
