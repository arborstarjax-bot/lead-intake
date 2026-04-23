import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.endpoint !== "string" ||
    !body.keys ||
    typeof body.keys.p256dh !== "string" ||
    typeof body.keys.auth !== "string"
  ) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("push_subscriptions")
    .upsert(
      {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: req.headers.get("user-agent") ?? null,
        user_id: auth.userId,
        workspace_id: auth.workspaceId,
      },
      { onConflict: "endpoint" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.endpoint !== "string") {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }
  const admin = createAdminClient();
  await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint)
    .eq("user_id", auth.userId);
  return NextResponse.json({ ok: true });
}
