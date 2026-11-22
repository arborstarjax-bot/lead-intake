import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope, requireAdminRole, ok, badRequest, notFound, serverError,
  WEBHOOK_EVENTS,
} from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "webhooks:manage");
  if (scopeErr) return scopeErr;
  const roleErr = requireAdminRole(auth);
  if (roleErr) return roleErr;

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const p = parsed.data;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.url !== undefined) row.url = p.url;
  if (p.events !== undefined) row.events = p.events;
  if (p.isActive !== undefined) row.is_active = p.isActive;

  const { data, error } = await createAdminClient()
    .from("webhook_subscriptions")
    .update(row)
    .eq("workspace_id", auth.workspaceId).eq("id", id)
    .select("id, url, events, is_active")
    .maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return notFound("Webhook");
  return ok({ id: data.id, url: data.url, events: data.events, isActive: data.is_active });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "webhooks:manage");
  if (scopeErr) return scopeErr;
  const roleErr = requireAdminRole(auth);
  if (roleErr) return roleErr;

  const { id } = await ctx.params;
  const { error, count } = await createAdminClient()
    .from("webhook_subscriptions")
    .delete({ count: "exact" })
    .eq("workspace_id", auth.workspaceId).eq("id", id);
  if (error) return serverError(error.message);
  if (!count) return notFound("Webhook");
  return ok({ deleted: true });
}
