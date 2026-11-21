import { NextRequest, NextResponse } from "next/server";
import { memberRoleSchema, removeMember, setMemberRole } from "@/modules/members/api";
import { resolveApiAuth, requireScope, handlerResult, badRequest, apiError } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdminRole(role: string) {
  return role === "admin" ? null : apiError(403, "forbidden", "Admin role required");
}

/** PATCH /api/v1/members/:userId { role } — promote/demote. Admin only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "members:write");
  if (scopeErr) return scopeErr;
  const roleErr = requireAdminRole(auth.role);
  if (roleErr) return roleErr;

  const { userId } = await params;
  const parsed = memberRoleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("role required");

  return handlerResult(await setMemberRole(auth.workspaceId, auth.userId, userId, parsed.data.role));
}

/** DELETE /api/v1/members/:userId — remove from workspace. Admin only. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "members:write");
  if (scopeErr) return scopeErr;
  const roleErr = requireAdminRole(auth.role);
  if (roleErr) return roleErr;

  const { userId } = await params;
  return handlerResult(await removeMember(auth.workspaceId, auth.userId, userId));
}
