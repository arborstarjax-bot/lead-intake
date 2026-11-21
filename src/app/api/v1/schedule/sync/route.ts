import { NextRequest, NextResponse } from "next/server";
import { syncDay, syncDaySchema } from "@/modules/schedule/api";
import { resolveApiAuth, requireScope, handlerResult, badRequest } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/schedule/sync { date } — batch-sync a day's stops to Google Calendar.
 *  Session auth only (API keys have no Google token). */
export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "schedule:write");
  if (scopeErr) return scopeErr;

  const parsed = syncDaySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return handlerResult(await syncDay(auth.workspaceId, auth.userId, parsed.data));
}
