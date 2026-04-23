import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/modules/shared/supabase/server";
import { signScreenshotUrl } from "@/lib/ingest";
import { requireMembership } from "@/modules/auth";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireMembership();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("leads")
    .select("screenshot_path")
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .single();
  const url = await signScreenshotUrl(data?.screenshot_path ?? null);
  if (!url) return NextResponse.json({ error: "No screenshot" }, { status: 404 });
  return NextResponse.redirect(url, { status: 302 });
}
