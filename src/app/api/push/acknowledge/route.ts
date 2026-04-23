import { NextRequest, NextResponse } from "next/server";
import { acknowledgeSubscription } from "@/lib/push";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const obj = body as Record<string, unknown>;

  // Web clients send { endpoint }; native Capacitor clients send
  // { device_token }. Accept either; acknowledgeSubscription scopes
  // the update by user_id so a token leak can't mark someone else's
  // device caught-up.
  const endpoint = typeof obj.endpoint === "string" ? obj.endpoint : undefined;
  const deviceToken =
    typeof obj.device_token === "string" ? obj.device_token : undefined;
  if (!endpoint && !deviceToken) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  await acknowledgeSubscription(auth.userId, {
    endpoint,
    device_token: deviceToken,
  });
  return NextResponse.json({ ok: true });
}
