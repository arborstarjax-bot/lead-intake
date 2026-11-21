import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, ok, badRequest, apiError, serverError,
  generateApiKey, ALL_SCOPES,
} from "@/modules/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Key management is session+admin only — API keys can't mint other keys.
async function requireAdminSession(req: NextRequest) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.via !== "session" || auth.role !== "admin") {
    return apiError(403, "forbidden", "Admin session required to manage API keys");
  }
  return auth;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await createAdminClient()
    .from("api_keys")
    .select("id, name, key_prefix, scopes, created_at, last_used_at, revoked_at")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false });
  if (error) return serverError(error.message);

  return ok((data ?? []).map((k) => ({
    id: k.id, name: k.name, prefix: k.key_prefix, scopes: k.scopes,
    createdAt: k.created_at, lastUsedAt: k.last_used_at,
    revoked: !!k.revoked_at,
  })));
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(ALL_SCOPES as [string, ...string[]])).min(1),
}).strict();

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req);
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }

  const { plaintext, hash, prefix } = generateApiKey();
  const { data, error } = await createAdminClient()
    .from("api_keys")
    .insert({
      workspace_id: auth.workspaceId,
      name: parsed.data.name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: parsed.data.scopes,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (error) return serverError(error.message);

  // Plaintext returned exactly once — only the hash is stored.
  return ok({ id: data.id, key: plaintext, prefix }, undefined, 201);
}
