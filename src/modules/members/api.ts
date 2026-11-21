import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";

/**
 * Shared member-management handlers. Both /api/workspace/members/[userId]
 * (session) and /api/v1/members/[userId] (session or Bearer key) call these.
 */

export const memberRoleSchema = z.object({ role: z.enum(["admin", "user"]) }).strict();
export type MemberRoleInput = z.infer<typeof memberRoleSchema>;

export type HandlerResult = { status: number; body: Record<string, unknown> };
const R = (status: number, body: Record<string, unknown>): HandlerResult => ({ status, body });

/**
 * Returns true when removing (or demoting) `targetUserId` would leave
 * the workspace with zero admins — losing the last admin locks every
 * admin action behind a DB-level fix.
 */
async function wouldOrphanWorkspace(
  workspaceId: string,
  targetUserId: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "admin");
  if (error) throw error;
  const adminIds = (data ?? []).map((r) => r.user_id);
  return adminIds.filter((id) => id !== targetUserId).length === 0;
}

/** Promote/demote a member. Caller must already be verified admin. */
export async function setMemberRole(
  workspaceId: string,
  actorUserId: string | null,
  targetUserId: string,
  role: "admin" | "user"
): Promise<HandlerResult> {
  if (targetUserId === actorUserId) {
    return R(400, { error: "Change your own role by having another admin promote you." });
  }
  if (role === "user") {
    let orphan: boolean;
    try {
      orphan = await wouldOrphanWorkspace(workspaceId, targetUserId);
    } catch (e) {
      return R(500, { error: (e as Error).message || "admin check failed" });
    }
    if (orphan) {
      return R(409, { error: "Can't demote the last admin. Promote someone else first, then retry." });
    }
  }

  const { error } = await createAdminClient()
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) return R(500, { error: error.message });
  return R(200, { ok: true });
}

/** Remove a member. Caller must already be verified admin. */
export async function removeMember(
  workspaceId: string,
  actorUserId: string | null,
  targetUserId: string
): Promise<HandlerResult> {
  if (targetUserId === actorUserId) {
    return R(400, { error: "You can't remove yourself from the workspace." });
  }
  let orphan: boolean;
  try {
    orphan = await wouldOrphanWorkspace(workspaceId, targetUserId);
  } catch (e) {
    return R(500, { error: (e as Error).message || "admin check failed" });
  }
  if (orphan) {
    return R(409, { error: "Can't remove the last admin. Promote someone else first, then retry." });
  }

  const { error } = await createAdminClient()
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) return R(500, { error: error.message });
  return R(200, { ok: true });
}
