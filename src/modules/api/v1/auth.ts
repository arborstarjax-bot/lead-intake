import "server-only";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { getSessionMembership } from "@/modules/auth/server";

/**
 * Auth resolution for /api/v1.
 *
 * Two callers share every endpoint:
 *   1. Session cookie → workspace_members row (the web app, for docs page
 *      "try it" calls and key/webhook management).
 *   2. `Authorization: Bearer lf_live_…` → api_keys row (integrations).
 *
 * Both resolve to the same { workspaceId, role } shape so resource
 * handlers never care which one they're serving.
 */
export type ApiAuth = {
  workspaceId: string;
  role: "admin" | "user";
  /** null for API-key callers — they aren't a person. */
  userId: string | null;
  via: "session" | "key";
  /** Present for key callers; used for scope checks. */
  scopes: string[];
};

/** Scopes understood by requireScope(). Admin sessions get everything. */
export type ApiScope =
  | "leads:read" | "leads:write"
  | "tasks:read" | "tasks:write"
  | "schedule:read" | "schedule:write"
  | "workspace:read"
  | "settings:read" | "settings:write"
  | "members:write"
  | "reports:read"
  | "webhooks:manage";

export const ALL_SCOPES: ApiScope[] = [
  "leads:read", "leads:write",
  "tasks:read", "tasks:write",
  "schedule:read", "schedule:write",
  "workspace:read", "settings:read", "settings:write",
  "members:write", "reports:read",
  "webhooks:manage",
];

const KEY_PLAINTEXT_PREFIX = "lf_live_";

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = KEY_PLAINTEXT_PREFIX + crypto.randomBytes(24).toString("base64url");
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    // Store enough to identify the key in UI without revealing it.
    prefix: plaintext.slice(0, 16),
  };
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

async function resolveKey(
  plaintext: string
): Promise<ApiAuth | NextResponse> {
  const admin = createAdminClient();
  const { data: key } = await admin
    .from("api_keys")
    .select("id, workspace_id, scopes, revoked_at")
    .eq("key_hash", hashApiKey(plaintext))
    .maybeSingle();

  if (!key || key.revoked_at) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid API key" } },
      { status: 401 }
    );
  }

  // Best-effort last_used_at bump; failure is harmless.
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id)
    .then(() => {}, () => {});

  return {
    workspaceId: key.workspace_id,
    role: "admin", // keys act as the workspace; scope gates write vs read
    userId: null,
    via: "key",
    scopes: key.scopes ?? [],
  };
}

/**
 * Resolve the caller. Returns ApiAuth or a 401 NextResponse.
 * Call sites: `const auth = await resolveApiAuth(req); if (auth instanceof NextResponse) return auth;`
 */
export async function resolveApiAuth(req: NextRequest): Promise<ApiAuth | NextResponse> {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.startsWith(KEY_PLAINTEXT_PREFIX)) {
      return resolveKey(token);
    }
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unrecognized token format" } },
      { status: 401 }
    );
  }

  const m = await getSessionMembership();
  if (!m) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in or provide a Bearer API key" } },
      { status: 401 }
    );
  }
  return {
    workspaceId: m.workspaceId,
    role: m.role,
    userId: m.userId,
    via: "session",
    scopes: ALL_SCOPES.slice(), // sessions get everything (role still gates admin UI actions)
  };
}

/** 403 when a key caller lacks `scope`. Session callers always pass. */
export function requireScope(auth: ApiAuth, scope: ApiScope): NextResponse | null {
  if (auth.via === "session") return null;
  if (auth.scopes.includes(scope)) return null;
  return NextResponse.json(
    { error: { code: "forbidden", message: `API key missing scope '${scope}'` } },
    { status: 403 }
  );
}
