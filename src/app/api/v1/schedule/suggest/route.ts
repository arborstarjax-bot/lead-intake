import { NextRequest, NextResponse } from "next/server";
import { suggest, suggestSchema } from "@/modules/schedule/api";
import { resolveApiAuth, requireScope, handlerResult, badRequest } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/schedule/suggest { leadId, half?, day?, offset? } — ranked time slots for a day. */
export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "schedule:read");
  if (scopeErr) return scopeErr;

  const parsed = suggestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return handlerResult(await suggest(auth.workspaceId, parsed.data, { emergencyAllowed: auth.role === "admin" }));
}
