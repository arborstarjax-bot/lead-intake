import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope,
  ok, badRequest, notFound, serverError,
  leadUpdateSchema, leadToContract, leadFromContract, LEAD_CONTRACT_SELECT,
  emitWebhookEvent,
} from "@/modules/api/v1";
import { normalizeEmail, normalizePhone, normalizeState, normalizeZip, displayName } from "@/modules/shared/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(_req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:read");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const { data, error } = await createAdminClient()
    .from("leads")
    .select(LEAD_CONTRACT_SELECT)
    .eq("workspace_id", auth.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return notFound("Lead");
  return ok(leadToContract(data as unknown as Record<string, unknown>));
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:write");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const parsed = leadUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const row = leadFromContract(parsed.data);
  if (Object.keys(row).length === 0) return badRequest("Empty patch");
  if ("phone_number" in row) row.phone_number = normalizePhone(row.phone_number as string | null) ?? row.phone_number;
  if ("email" in row) row.email = normalizeEmail(row.email as string | null) ?? row.email;
  if ("state" in row) row.state = normalizeState(row.state as string | null) ?? row.state;
  if ("zip" in row) row.zip = normalizeZip(row.zip as string | null) ?? row.zip;
  if (!("client" in row) && ("first_name" in row || "last_name" in row)) {
    row.client = displayName(row.first_name as string | null, row.last_name as string | null) || null;
  }
  row.updated_at = new Date().toISOString();

  const { data, error } = await createAdminClient()
    .from("leads")
    .update(row)
    .eq("workspace_id", auth.workspaceId)
    .eq("id", id)
    .select(LEAD_CONTRACT_SELECT)
    .maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return notFound("Lead");

  const contract = leadToContract(data as unknown as Record<string, unknown>) as Record<string, unknown>;
  void emitWebhookEvent(auth.workspaceId, "lead.updated", contract);
  const outcome = (data as unknown as Record<string, unknown>).estimate_outcome as string | null;
  if (outcome === "Sold") void emitWebhookEvent(auth.workspaceId, "lead.sold", contract);
  if ((data as unknown as Record<string, unknown>).status === "Lost") void emitWebhookEvent(auth.workspaceId, "lead.lost", contract);
  return ok(contract);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(_req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:write");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const { error, count } = await createAdminClient()
    .from("leads")
    .delete({ count: "exact" })
    .eq("workspace_id", auth.workspaceId)
    .eq("id", id);
  if (error) return serverError(error.message);
  if (!count) return notFound("Lead");
  return ok({ deleted: true });
}
