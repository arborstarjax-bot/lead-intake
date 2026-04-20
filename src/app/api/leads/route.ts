import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const view = req.nextUrl.searchParams.get("view") ?? "active";
  let query = supabase.from("leads").select("*").order("created_at", { ascending: false });
  if (view === "completed") {
    query = query.eq("status", "Completed");
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
