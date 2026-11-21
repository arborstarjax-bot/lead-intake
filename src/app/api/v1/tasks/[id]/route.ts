import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope,
  ok, badRequest, notFound, serverError,
  taskUpdateSchema, taskToContract, taskFromContract, TASK_CONTRACT_SELECT,
  emitWebhookEvent,
} from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "tasks:read");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const { data, error } = await createAdminClient()
    .from("tasks").select(TASK_CONTRACT_SELECT)
    .eq("workspace_id", auth.workspaceId).eq("id", id).maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return notFound("Task");
  return ok(taskToContract(data as unknown as Record<string, unknown>));
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "tasks:write");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const parsed = taskUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const row = taskFromContract(parsed.data);
  if (Object.keys(row).length === 0) return badRequest("Empty patch");

  const { data, error } = await createAdminClient()
    .from("tasks").update(row)
    .eq("workspace_id", auth.workspaceId).eq("id", id)
    .select(TASK_CONTRACT_SELECT).maybeSingle();
  if (error) return serverError(error.message);
  if (!data) return notFound("Task");

  const contract = taskToContract(data as unknown as Record<string, unknown>);
  if ((data as unknown as Record<string, unknown>).status === "Completed") {
    void emitWebhookEvent(auth.workspaceId, "task.completed", contract);
  }
  return ok(contract);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "tasks:write");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const { error, count } = await createAdminClient()
    .from("tasks").delete({ count: "exact" })
    .eq("workspace_id", auth.workspaceId).eq("id", id);
  if (error) return serverError(error.message);
  if (!count) return notFound("Task");
  return ok({ deleted: true });
}
