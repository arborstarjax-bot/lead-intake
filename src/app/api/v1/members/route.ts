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

  const admin = createAdminClient();
  const { data: members, error } = await admin
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: true });
  if (error) return serverError(error.message);

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((users?.users ?? []).map((u) => [u.id, u.email]));

  return ok(
    (members ?? []).map((m) => ({
      userId: m.user_id,
      email: emailById.get(m.user_id) ?? null,
      role: m.role,
      joinedAt: m.created_at,
    }))
  );
}
