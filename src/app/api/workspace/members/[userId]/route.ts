import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/server";
import { memberRoleSchema, removeMember, setMemberRole } from "@/modules/members/api";

export const dynamic = "force-dynamic";

/** Promote/demote a member. Admin only; can't change your own role. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  const parsed = memberRoleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "role required" }, { status: 400 });
  }

  const { status, body } = await setMemberRole(
    auth.workspaceId,
    auth.userId,
    userId,
    parsed.data.role
  );
  return NextResponse.json(body, { status });
}

/** Remove a member from the workspace. Admin only; can't kick yourself. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  const { status, body } = await removeMember(auth.workspaceId, auth.userId, userId);
  return NextResponse.json(body, { status });
}
