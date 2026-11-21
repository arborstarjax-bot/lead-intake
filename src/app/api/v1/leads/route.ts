import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope,
  ok, badRequest, serverError, listParams, pageMeta,
  leadCreateSchema, leadToContract, leadFromContract, LEAD_CONTRACT_SELECT,
  emitWebhookEvent, processRetries,
} from "@/modules/api/v1";
import { normalizeEmail, normalizePhone, normalizeState, normalizeZip, displayName } from "@/modules/shared/format";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:read");
  if (scopeErr) return scopeErr;

  void processRetries();
  const { limit, cursor, updatedSince, status } = listParams(req);

  let q = createAdminClient()
    .from("leads")
    .select(LEAD_CONTRACT_SELECT)
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (status) q = q.eq("status", status);
  if (updatedSince) q = q.gt("updated_at", updatedSince);
  if (cursor) q = q.lt("created_at", cursor.createdAt);

  const { data, error } = await q;
  if (error) return serverError(error.message);

  const rows = (data ?? []) as unknown as Record<string, unknown>[] & { created_at: string; id: string }[];
  const meta = pageMeta(rows, limit);
  return ok(rows.slice(0, limit).map(leadToContract), meta);
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:write");
  if (scopeErr) return scopeErr;

  const parsed = leadCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const row = leadFromContract(parsed.data);
  row.status = row.status ?? "New";
  row.intake_source = "api";
  row.intake_status = "ready";
  row.workspace_id = auth.workspaceId;
  if (!row.client) {
    row.client = displayName(row.first_name as string | null, row.last_name as string | null) || null;
  }
  if ("phone_number" in row) row.phone_number = normalizePhone(row.phone_number as string | null) ?? row.phone_number;
  if ("email" in row) row.email = normalizeEmail(row.email as string | null) ?? row.email;
  if ("state" in row) row.state = normalizeState(row.state as string | null) ?? row.state;
  if ("zip" in row) row.zip = normalizeZip(row.zip as string | null) ?? row.zip;
  if (!("sales_person" in row)) {
    const settings = await getSettings(auth.workspaceId);
    if (settings.default_salesperson) row.sales_person = settings.default_salesperson;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("leads").insert(row).select(LEAD_CONTRACT_SELECT).single();
  if (error) return serverError(error.message);

  try {
    await supabase.from("lead_activities").insert({
      workspace_id: auth.workspaceId,
      lead_id: (data as unknown as { id: string }).id,
      type: "lead_intake",
      details: { source: "api" },
    });
  } catch { /* cosmetic */ }

  const contract = leadToContract(data as unknown as Record<string, unknown>);
  void emitWebhookEvent(auth.workspaceId, "lead.created", contract);
  return ok(contract, undefined, 201);
}
