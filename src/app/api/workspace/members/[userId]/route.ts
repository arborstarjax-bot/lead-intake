import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/modules/auth";
import { createAdminClient } from "@/modules/shared/supabase/server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ role: z.enum(["admin", "user"]) });

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/**
 * Returns true when removing (or demoting) `targetUserId` would leave
 * the workspace with zero admins. Used to refuse the last admin's
 * removal — losing the last admin locks every admin action behind a
 * DB-level fix.
 */
async function wouldOrphanWorkspace(
  admin: SupabaseAdmin,
  workspaceId: string,
  targetUserId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "admin");
  // Propagate DB errors instead of falling back to `data ?? []` — an
  // empty list would otherwise look like "zero admins remain" and the
  // caller would mask a transient DB failure as a misleading 409
  // "Can't demote the last admin" error.
  if (error) throw error;
  const adminIds = (data ?? []).map((r) => r.user_id);
  const remaining = adminIds.filter((id) => id !== targetUserId);
  return remaining.length === 0;
}

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

  // Only relevant when demoting: promoting to admin can never orphan.
  // Two admins racing to demote each other would otherwise both succeed
  // and leave the workspace with zero admins — recoverable only via SQL.
  if (parsed.data.role === "user") {
    let orphan: boolean;
    try {
      orphan = await wouldOrphanWorkspace(admin, auth.workspaceId, userId);
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message || "admin check failed" },
        { status: 500 }
      );
    }
    if (orphan) {
      return NextResponse.json(
        {
          error:
            "Can't demote the last admin. Promote someone else first, then retry.",
        },
        { status: 409 }
      );
    }
  }

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

  // Refuse to kick the last remaining admin. Same rationale as the
  // demote guard — a workspace with zero admins can't self-repair.
  let orphan: boolean;
  try {
    orphan = await wouldOrphanWorkspace(admin, auth.workspaceId, userId);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "admin check failed" },
      { status: 500 }
    );
  }
  if (orphan) {
    return NextResponse.json(
      {
        error:
          "Can't remove the last admin. Promote someone else first, then retry.",
      },
      { status: 409 }
    );
  }

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
