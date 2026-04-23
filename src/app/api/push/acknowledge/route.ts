import { NextRequest, NextResponse } from "next/server";
import { acknowledgeSubscription } from "@/lib/push";
import { requireMembership } from "@/modules/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.endpoint !== "string") {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }
  await acknowledgeSubscription(auth.userId, body.endpoint);
  return NextResponse.json({ ok: true });
}
