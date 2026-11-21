import { NextRequest, NextResponse } from "next/server";
import { weekPreview, weekPreviewSchema } from "@/modules/schedule/api";
import { resolveApiAuth, requireScope, handlerResult, badRequest } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/schedule/preview { leadId, horizonDays? } — rank upcoming days by drive time. */
export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "schedule:read");
  if (scopeErr) return scopeErr;

  const parsed = weekPreviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return handlerResult(await weekPreview(auth.workspaceId, parsed.data));
}
