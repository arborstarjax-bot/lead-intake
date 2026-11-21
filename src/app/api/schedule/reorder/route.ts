import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "@/modules/auth/server";
import { reorderDay, reorderSchema } from "@/modules/schedule/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/schedule/reorder
 *
 * Take a manual reorder of a day's stops, compact them back-to-back from
 * work_start using real drive legs, PATCH each lead's scheduled_time, and
 * (by default) resync any lead whose time moved to Google Calendar.
 */
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = reorderSchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { status, body } = await reorderDay(auth.workspaceId, auth.userId, parsed);
  return NextResponse.json(body, { status });
}
