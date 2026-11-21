import { NextRequest, NextResponse } from "next/server";
import { smartBook, smartBookSchema } from "@/modules/schedule/api";
import { resolveApiAuth, requireScope, handlerResult, badRequest } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/schedule/book { leadId, mode?, day? } — smart booking recommendations. */
export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "schedule:read");
  if (scopeErr) return scopeErr;

  const parsed = smartBookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return handlerResult(await smartBook(auth.workspaceId, parsed.data));
}
