import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import {
  displayName,
  normalizeEmail,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from "@/modules/shared/format";
import { getSettings } from "@/lib/settings";
import { requireMembership } from "@/modules/auth/server";

export const runtime = "nodejs";

/**
 * Best-effort sweep that runs before every list fetch:
 *
 * 1. New leads older than `days_until_lost` → Lost (never contacted)
 * 2. Needs Follow-Up leads older than `days_until_not_sold` → Completed / Not Sold
 *    (contacted but no resolution — auto-closed)
 *
 * Both thresholds come from `app_settings`; fallback to 30 days when the
 * columns haven't been added yet (graceful rollout).
 */
async function sweepStaleLeads(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  daysUntilLost: number,
  daysUntilNotSold: number,
): Promise<void> {
  const lostCutoff = new Date(
    Date.now() - daysUntilLost * 24 * 60 * 60 * 1000
  ).toISOString();
  const notSoldCutoff = new Date(
    Date.now() - daysUntilNotSold * 24 * 60 * 60 * 1000
  ).toISOString();
  try {
    // New leads with no contact → Lost (Expired)
    await supabase
      .from("leads")
      .update({ status: "Lost", follow_up_result: "Expired" })
      .eq("workspace_id", workspaceId)
      .eq("status", "New")
      .lt("status_changed_at", lostCutoff);
    // Needs Follow-Up leads with no outcome → Not Sold (Expired)
    await supabase
      .from("leads")
      .update({
        status: "Completed",
        estimate_outcome: "Not Sold",
        outcome_badge: "Not Sold",
        follow_up_result: "Expired",
      })
      .eq("workspace_id", workspaceId)
      .eq("status", "Called / No Response")
      .lt("status_changed_at", notSoldCutoff);
  } catch {
    // column missing or other transient error — ignore; sweep resumes next request
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const settings = await getSettings(auth.workspaceId);
  await sweepStaleLeads(
    supabase,
    auth.workspaceId,
    settings.days_until_lost ?? 30,
    settings.days_until_not_sold ?? 30,
  );

  const view = req.nextUrl.searchParams.get("view") ?? "active";
  let query = supabase
    .from("leads")
    .select("*")
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false });
  if (view === "completed") {
    query = query.eq("status", "Completed");
  } else if (view === "all") {
    // no status filter
  } else {
    query = query.neq("status", "Completed");
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data });
}

export async function POST(req: NextRequest) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const supabase = createAdminClient();
  const payload = await req.json().catch(() => ({}));
  // Never trust workspace_id from the client — always stamp it from session.
  const { workspace_id: _drop, ...safe } = payload ?? {};
  void _drop;
  const base = {
    status: "New" as const,
    intake_source: "manual" as const,
    intake_status: "ready" as const,
    ...safe,
    workspace_id: auth.workspaceId,
  };
  if (!base.client) {
    base.client = displayName(base.first_name, base.last_name) || null;
  }
  // Normalize contact fields on the way in so storage is consistent with
  // PATCH. Mirrors the logic in /api/leads/[id]. Falls back to the raw
  // input if normalization returns null (e.g. fewer than 10 phone digits)
  // so users don't silently lose what they typed.
  if ("phone_number" in base)
    base.phone_number =
      normalizePhone(base.phone_number as string | null) ?? base.phone_number;
  if ("email" in base)
    base.email = normalizeEmail(base.email as string | null) ?? base.email;
  if ("state" in base)
    base.state = normalizeState(base.state as string | null) ?? base.state;
  if ("zip" in base)
    base.zip = normalizeZip(base.zip as string | null) ?? base.zip;
  // Default the salesperson to the workspace's configured
  // default_salesperson (a human display name), NOT the creator's email.
  // `sales_person` is rendered into customer-facing SMS/email templates
  // via the {salesPerson} placeholder — leaking an email like
  // "Hi Jane, this is john@example.com with Acme Tree…" is a real bug.
  // We leave sales_person null if no default is configured; the template
  // renderer's existing fallback chain keeps messages clean either way.
  if (!("sales_person" in base)) {
    const settings = await getSettings(auth.workspaceId);
    if (settings.default_salesperson) {
      base.sales_person = settings.default_salesperson;
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .insert(base)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Seed the activity timeline with an intake event. Errors here don't
  // fail the lead-create request — a missing timeline row is a strictly
  // cosmetic degradation.
  try {
    await supabase.from("lead_activities").insert({
      workspace_id: auth.workspaceId,
      lead_id: data.id,
      type: "lead_intake",
      details: { source: base.intake_source },
    });
  } catch {
    // Non-blocking.
  }
  return NextResponse.json({ lead: data });
}
