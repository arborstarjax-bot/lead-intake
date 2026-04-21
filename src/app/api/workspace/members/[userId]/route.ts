import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ role: z.enum(["admin", "user"]) });

/** Promote/demote a member. Admin only; can't change your own role. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  if (userId === auth.userId) {
    return NextResponse.json(
      { error: "Change your own role by having another admin promote you." },
      { status: 400 }
    );
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "role required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_members")
    .update({ role: parsed.data.role })
    .eq("workspace_id", auth.workspaceId)
    .eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Remove a member from the workspace. Admin only; can't kick yourself. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  if (userId === auth.userId) {
    return NextResponse.json(
      { error: "You can't remove yourself from the workspace." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", auth.workspaceId)
    .eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
