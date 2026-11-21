import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope, ok, notFound, serverError, toCamel,
} from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/webhooks/{id}/deliveries — recent delivery attempts + status. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "webhooks:manage");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const supabase = createAdminClient();

  const { data: sub } = await supabase
    .from("webhook_subscriptions")
    .select("id")
    .eq("workspace_id", auth.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!sub) return notFound("Webhook subscription");

  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("id, event, status, attempts, next_retry_at, last_status_code, last_error, created_at")
    .eq("subscription_id", id)
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return serverError(error.message);

  return ok((data ?? []).map((d) => toCamel(d)));
}
