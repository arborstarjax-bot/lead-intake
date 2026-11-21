import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  resolveApiAuth, requireScope,
  ok, notFound, badRequest, serverError, toCamel,
} from "@/modules/api/v1";
import { LEAD_ACTIVITY_LABELS, LEAD_ACTIVITY_TYPES } from "@/modules/leads/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:read");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const supabase = createAdminClient();
  const { data: lead } = await supabase
    .from("leads").select("id").eq("workspace_id", auth.workspaceId).eq("id", id).maybeSingle();
  if (!lead) return notFound("Lead");

  const { data, error } = await supabase
    .from("lead_activities")
    .select("id, type, details, created_at")
    .eq("workspace_id", auth.workspaceId)
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return serverError(error.message);

  return ok(
    (data ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      label: LEAD_ACTIVITY_LABELS[a.type as keyof typeof LEAD_ACTIVITY_LABELS] ?? a.type,
      details: toCamel(a.details ?? {}),
      createdAt: a.created_at,
    }))
  );
}

const postSchema = z
  .object({
    type: z.enum(LEAD_ACTIVITY_TYPES),
    details: z.record(z.unknown()).optional(),
    /** Convenience: shorthand for details.note — CRMs push "note"/"call" events. */
    note: z.string().max(4000).optional(),
  })
  .strict();

/**
 * POST /api/v1/leads/{id}/activities — append a timeline event, e.g. a
 * call or note logged by an external CRM.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  const scopeErr = requireScope(auth, "leads:write");
  if (scopeErr) return scopeErr;

  const { id } = await ctx.params;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const supabase = createAdminClient();
  const { data: lead } = await supabase
    .from("leads").select("id").eq("workspace_id", auth.workspaceId).eq("id", id).maybeSingle();
  if (!lead) return notFound("Lead");

  const details = { ...(parsed.data.details ?? {}) };
  if (parsed.data.note) details.note = parsed.data.note;

  const { data, error } = await supabase
    .from("lead_activities")
    .insert({
      workspace_id: auth.workspaceId,
      lead_id: id,
      type: parsed.data.type,
      details,
    })
    .select("id, type, details, created_at")
    .single();
  if (error) return serverError(error.message);

  return ok(
    {
      id: data.id,
      type: data.type,
      label: LEAD_ACTIVITY_LABELS[data.type as keyof typeof LEAD_ACTIVITY_LABELS] ?? data.type,
      details: toCamel(data.details ?? {}),
      createdAt: data.created_at,
    },
    undefined,
    201
  );
}
