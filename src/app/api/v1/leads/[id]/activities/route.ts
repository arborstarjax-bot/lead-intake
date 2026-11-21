import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope,
  ok, notFound, serverError, toCamel,
} from "@/modules/api/v1";
import { LEAD_ACTIVITY_LABELS } from "@/modules/leads/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:read");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const supabase = createAdminClient();
  const { data: lead } = await supabase
    .from("leads").select("id").eq("workspace_id", auth.workspaceId).eq("id", id).maybeSingle();
  if (!lead) return notFound("Lead");

  const { data, error } = await supabase
    .from("lead_activities")
    .select("id, type, details, created_at")
    .eq("workspace_id", auth.workspaceId)
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return serverError(error.message);

  return ok(
    (data ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      label: LEAD_ACTIVITY_LABELS[a.type as keyof typeof LEAD_ACTIVITY_LABELS] ?? a.type,
      details: toCamel(a.details ?? {}),
      createdAt: a.created_at,
    }))
  );
}
