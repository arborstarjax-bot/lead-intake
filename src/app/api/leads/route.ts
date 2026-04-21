import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { LOST_AFTER_DAYS } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Best-effort sweep: promote any "Called / No Response" lead whose status
 * hasn't changed in >= LOST_AFTER_DAYS to "Lost". Runs before every list
 * fetch so the UI stays consistent without a scheduled job.
 *
 * Safe to no-op if the `status_changed_at` column doesn't exist yet
 * (first deploy before the SQL migration runs).
 */
async function sweepLostLeads(
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  const cutoff = new Date(
    Date.now() - LOST_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  try {
    await supabase
      .from("leads")
      .update({ status: "Lost" })
      .eq("status", "Called / No Response")
      .lt("status_changed_at", cutoff);
  } catch {
    // column missing or other transient error — ignore; sweep resumes next request
  }
}

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  await sweepLostLeads(supabase);

  const view = req.nextUrl.searchParams.get("view") ?? "active";
  let query = supabase.from("leads").select("*").order("created_at", { ascending: false });
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
  const supabase = createAdminClient();
  const payload = await req.json().catch(() => ({}));
  const base = {
    status: "New" as const,
    intake_source: "manual" as const,
    intake_status: "ready" as const,
    ...payload,
  };
  if (!base.client) {
    base.client = displayName(base.first_name, base.last_name) || null;
  }

  const { data, error } = await supabase
    .from("leads")
    .insert(base)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lead: data });
}
