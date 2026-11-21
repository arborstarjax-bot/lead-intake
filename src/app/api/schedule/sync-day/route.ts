import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/modules/auth/server";
import { syncDay, syncDaySchema } from "@/modules/schedule/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/schedule/sync-day
 *
 * Batch-sync every scheduled stop on a day to Google Calendar.
 */
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = syncDaySchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { status, body } = await syncDay(auth.workspaceId, auth.userId, parsed);
  return NextResponse.json(body, { status });
}
