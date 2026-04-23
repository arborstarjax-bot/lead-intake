import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

/**
 * POST /api/push/subscribe
 *
 * Accepts two payload shapes — the original web push body plus the native
 * Capacitor body sent by the iOS / Android shell. The native body carries
 * only a device token (APNs / FCM registration id) and no VAPID endpoint
 * or keys, so it's stored in the `device_token` column via the schema
 * extension added in 20260502000001_push_native_platform.sql.
 *
 *   Web:    { endpoint, keys: { p256dh, auth } }
 *   Native: { platform: "ios" | "android", device_token, app_version? }
 *
 * The platform is inferred from the body shape to keep the existing web
 * clients unchanged. Each path writes to a disjoint set of columns, so
 * the DB-level CHECK constraint enforces payload validity even if this
 * handler ever drifts.
 */
export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const parsed = parseSubscribeBody(body as Record<string, unknown>);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const admin = createAdminClient();
  const userAgent = req.headers.get("user-agent") ?? null;

  if (parsed.platform === "web") {
    const { error } = await admin
      .from("push_subscriptions")
      .upsert(
        {
          platform: "web",
          endpoint: parsed.endpoint,
          p256dh: parsed.p256dh,
          auth: parsed.auth,
          device_token: null,
          app_version: null,
          user_agent: userAgent,
          user_id: auth.userId,
          workspace_id: auth.workspaceId,
        },
        { onConflict: "endpoint" }
      );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Native (ios / android): keyed on (workspace_id, device_token) so a
  // reinstall / token rotation overwrites rather than duplicates.
  const { error } = await admin
    .from("push_subscriptions")
    .upsert(
      {
        platform: parsed.platform,
        endpoint: null,
        p256dh: null,
        auth: null,
        device_token: parsed.device_token,
        app_version: parsed.app_version ?? null,
        user_agent: userAgent,
        user_id: auth.userId,
        workspace_id: auth.workspaceId,
      },
      { onConflict: "workspace_id,device_token" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const admin = createAdminClient();
  const obj = body as Record<string, unknown>;

  // Web clients delete by endpoint (existing behavior); native clients
  // delete by device_token. user_id scope prevents one device from
  // tearing down another user's subscription.
  if (typeof obj.endpoint === "string") {
    await admin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", obj.endpoint)
      .eq("user_id", auth.userId);
    return NextResponse.json({ ok: true });
  }
  if (typeof obj.device_token === "string") {
    await admin
      .from("push_subscriptions")
      .delete()
      .eq("device_token", obj.device_token)
      .eq("user_id", auth.userId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
}

type ParsedBody =
  | { platform: "web"; endpoint: string; p256dh: string; auth: string }
  | {
      platform: "ios" | "android";
      device_token: string;
      app_version?: string;
    };

function parseSubscribeBody(body: Record<string, unknown>): ParsedBody | null {
  const platformField = typeof body.platform === "string" ? body.platform : null;

  if (platformField === "ios" || platformField === "android") {
    const deviceToken = body.device_token;
    if (typeof deviceToken !== "string" || deviceToken.length === 0)
      return null;
    const appVersion =
      typeof body.app_version === "string" ? body.app_version : undefined;
    return {
      platform: platformField,
      device_token: deviceToken,
      app_version: appVersion,
    };
  }

  // Fallback to the web push shape — platform may be omitted (existing
  // clients) or explicitly "web".
  if (platformField !== null && platformField !== "web") return null;
  const endpoint = body.endpoint;
  const keys =
    body.keys && typeof body.keys === "object"
      ? (body.keys as Record<string, unknown>)
      : null;
  if (
    typeof endpoint !== "string" ||
    !keys ||
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string"
  ) {
    return null;
  }
  return {
    platform: "web",
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  };
}
