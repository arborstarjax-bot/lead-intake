import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope, ok, badRequest, serverError,
  webhookSubSchema,
} from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "webhooks:manage");
  if (scopeErr) return scopeErr;

  const { data, error } = await createAdminClient()
    .from("webhook_subscriptions")
    .select("id, url, events, is_active, created_at")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false });
  if (error) return serverError(error.message);

  return ok((data ?? []).map((s) => ({
    id: s.id, url: s.url, events: s.events, isActive: s.is_active, createdAt: s.created_at,
  })));
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "webhooks:manage");
  if (scopeErr) return scopeErr;

  const parsed = webhookSubSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const { data, error } = await createAdminClient()
    .from("webhook_subscriptions")
    .insert({
      workspace_id: auth.workspaceId,
      url: parsed.data.url,
      events: parsed.data.events,
      secret,
    })
    .select("id")
    .single();
  if (error) return serverError(error.message);

  // Secret returned once — subscribers verify the x-leadflow-signature HMAC.
  return ok({ id: data.id, secret }, undefined, 201);
}
