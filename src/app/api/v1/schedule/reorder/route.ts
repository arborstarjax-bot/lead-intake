import { NextRequest, NextResponse } from "next/server";
import { reorderDay, reorderSchema } from "@/modules/schedule/api";
import { resolveApiAuth, requireScope, handlerResult, badRequest } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/schedule/reorder { date, orderedLeadIds, sync? } — re-time a day's stops. */
export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "schedule:write");
  if (scopeErr) return scopeErr;

  const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return handlerResult(await reorderDay(auth.workspaceId, auth.userId, parsed.data));
}
