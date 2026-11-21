import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/modules/auth/server";
import { todayIsoInBusinessTz } from "@/modules/shared/date";
import { dayRoute } from "@/modules/schedule/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const settings = await getSettings(auth.workspaceId);
  // Pin to the workspace's timezone so the route always reflects the
  // business day. Vercel runs UTC; without this, between ~8 PM and
  // midnight we'd query tomorrow's leads and show an empty route.
  const iso = todayIsoInBusinessTz(settings.timezone);

  const { status, body } = await dayRoute(auth.workspaceId, iso);
  return NextResponse.json(body, { status });
}
