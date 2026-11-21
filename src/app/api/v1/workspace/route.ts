import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { resolveApiAuth, requireScope, ok, serverError } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "workspace:read");
  if (scopeErr) return scopeErr;

  const { data, error } = await createAdminClient()
    .from("workspaces")
    .select("id, name, join_code, created_at")
    .eq("id", auth.workspaceId)
    .single();
  if (error) return serverError(error.message);
  return ok({
    id: data.id,
    name: data.name,
    joinCode: data.join_code,
    createdAt: data.created_at,
  });
}
