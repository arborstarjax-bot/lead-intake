import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { todayIsoInBusinessTz } from "@/modules/shared/date";
import { dayRoute } from "@/modules/schedule/api";
import { resolveApiAuth, requireScope, handlerResult, badRequest } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/schedule/day?date=YYYY-MM-DD — the ordered stops + drive legs for a day. */
export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "schedule:read");
  if (scopeErr) return scopeErr;

  const date = req.nextUrl.searchParams.get("date");
  let iso: string;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date must be YYYY-MM-DD");
    iso = date;
  } else {
    const settings = await getSettings(auth.workspaceId);
    iso = todayIsoInBusinessTz(settings.timezone);
  }

  return handlerResult(await dayRoute(auth.workspaceId, iso));
}
