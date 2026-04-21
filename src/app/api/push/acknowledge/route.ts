import { NextRequest, NextResponse } from "next/server";
import { acknowledgeSubscription } from "@/lib/push";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.endpoint !== "string") {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }
  await acknowledgeSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}
