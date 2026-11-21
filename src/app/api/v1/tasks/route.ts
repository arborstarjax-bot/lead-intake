import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope,
  ok, badRequest, serverError, listParams, pageMeta,
  taskCreateSchema, taskToContract, taskFromContract, TASK_CONTRACT_SELECT,
  emitWebhookEvent, processRetries,
} from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "tasks:read");
  if (scopeErr) return scopeErr;

  void processRetries();
  const { limit, cursor, updatedSince, status } = listParams(req);

  let q = createAdminClient()
    .from("tasks")
    .select(TASK_CONTRACT_SELECT)
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
  return ok(rows.slice(0, limit).map(taskToContract), meta);
}

export async function POST(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "tasks:write");
  if (scopeErr) return scopeErr;

  const parsed = taskCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const row = taskFromContract(parsed.data);
  row.status = row.status ?? "Scheduled";
  row.workspace_id = auth.workspaceId;
  row.created_by = auth.userId;
  row.extraction_source = "manual";

  const { data, error } = await createAdminClient()
    .from("tasks").insert(row).select(TASK_CONTRACT_SELECT).single();
  if (error) return serverError(error.message);

  const contract = taskToContract(data as unknown as Record<string, unknown>);
  void emitWebhookEvent(auth.workspaceId, "task.created", contract);
  return ok(contract, undefined, 201);
}
