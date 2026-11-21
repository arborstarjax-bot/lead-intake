import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { ingestScreenshot, ingestText } from "@/modules/ingest/server";
import { checkIngestQuota } from "@/modules/ingest/server";
import {
  resolveApiAuth, requireScope, ok, badRequest, apiError,
} from "@/modules/api/v1";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    /** Pasted lead text (ad copy, email, message). */
    text: z.string().trim().min(10).max(20_000).optional(),
    /** Screenshots as base64 data URLs (data:image/png;base64,…). Max 5. */
    images: z.array(z.string().startsWith("data:image/")).max(5).optional(),
  })
  .strict()
  .refine((b) => b.text || (b.images && b.images.length > 0), {
    message: "Provide `text` or `images`",
  });

/**
 * POST /api/v1/ingest — run the extraction pipeline on lead text or
 * screenshots and create lead rows. Same billing + daily-quota rules as
 * the app's upload button.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:write");
  if (scopeErr) return scopeErr;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const imageCount = parsed.data.images?.length ?? 0;
  const n = (parsed.data.text ? 1 : 0) + imageCount;

  const quota = await checkIngestQuota(auth.workspaceId, n);
  if (!quota.ok) {
    return apiError(quota.status, String(quota.body.reason ?? "rejected"), String(quota.body.error));
  }

  const settings = await getSettings(auth.workspaceId);
  const fallbackSalesperson = settings.default_salesperson || null;

  const results: Record<string, unknown>[] = [];
  const errors: string[] = [];

  if (parsed.data.text) {
    try {
      const res = await ingestText({
        workspaceId: auth.workspaceId,
        text: parsed.data.text,
        defaultSalesperson: fallbackSalesperson,
      });
      results.push({ kind: "text", leadId: res.lead_id, intakeStatus: res.intake_status });
    } catch (e) {
      errors.push(`text: ${(e as Error).message}`);
    }
  }

  for (const [i, dataUrl] of (parsed.data.images ?? []).entries()) {
    try {
      const [mime, b64] = dataUrl.split(";base64,");
      const type = mime.replace("data:", "") || "image/jpeg";
      const blob = new Blob([Buffer.from(b64 ?? "", "base64")], { type });
      const res = await ingestScreenshot({
        workspaceId: auth.workspaceId,
        file: blob,
        fileName: `ingest-${i + 1}.png`,
        source: "api",
        defaultSalesperson: fallbackSalesperson,
      });
      results.push({ kind: "image", leadId: res.lead_id, intakeStatus: res.intake_status });
    } catch (e) {
      errors.push(`image[${i}]: ${(e as Error).message}`);
    }
  }

  if (errors.length > 0) await quota.refund(errors.length);
  return ok({ created: results.length, results, errors }, undefined, errors.length ? 207 : 201);
}
