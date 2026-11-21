import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { resolveApiAuth, ok, apiError, notFound, serverError } from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.via !== "session" || auth.role !== "admin") {
    return apiError(403, "forbidden", "Admin session required to revoke API keys");
  }

  const { id } = await ctx.params;
  const { data, error } = await createAdminClient()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", auth.workspaceId)
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");
  if (error) return serverError(error.message);
  if (!data?.length) return notFound("API key");
  return ok({ revoked: true });
}
