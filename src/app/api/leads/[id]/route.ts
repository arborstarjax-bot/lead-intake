import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { EDITABLE_COLUMNS, LEAD_STATUSES } from "@/lib/types";
import { displayName, normalizeEmail, normalizePhone, normalizeState, normalizeZip } from "@/lib/format";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createAdminClient();

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_COLUMNS) {
    if (k in body) patch[k] = body[k];
  }
  if (patch.status && !LEAD_STATUSES.includes(patch.status as never)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if ("phone_number" in patch)
    patch.phone_number = normalizePhone(patch.phone_number as string | null) ?? patch.phone_number;
  if ("email" in patch)
    patch.email = normalizeEmail(patch.email as string | null) ?? patch.email;
  if ("state" in patch)
    patch.state = normalizeState(patch.state as string | null) ?? patch.state;
  if ("zip" in patch)
    patch.zip = normalizeZip(patch.zip as string | null) ?? patch.zip;

  if (!("client" in patch) && ("first_name" in patch || "last_name" in patch)) {
    const { data: row } = await supabase
      .from("leads")
      .select("first_name, last_name, client")
      .eq("id", id)
      .single();
    if (row) {
      const first = "first_name" in patch ? (patch.first_name as string | null) : row.first_name;
      const last = "last_name" in patch ? (patch.last_name as string | null) : row.last_name;
      const derived = displayName(first, last);
      if (!row.client || row.client === displayName(row.first_name, row.last_name)) {
        patch.client = derived || null;
      }
    }
  }

  // Client Name is now the only name column in the UI. When it changes,
  // split it back into first_name / last_name so calendar event titles and
  // duplicate detection stay in sync with what the user typed.
  if ("client" in patch && !("first_name" in patch) && !("last_name" in patch)) {
    const raw = (patch.client as string | null) ?? "";
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      patch.first_name = null;
      patch.last_name = null;
    } else {
      const idx = trimmed.indexOf(" ");
      if (idx === -1) {
        patch.first_name = trimmed;
        patch.last_name = null;
      } else {
        patch.first_name = trimmed.slice(0, idx);
        patch.last_name = trimmed.slice(idx + 1);
      }
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lead: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
