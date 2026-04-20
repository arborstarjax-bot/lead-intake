import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signScreenshotUrl } from "@/lib/ingest";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("leads")
    .select("screenshot_path")
    .eq("id", id)
    .single();
  const url = await signScreenshotUrl(data?.screenshot_path ?? null);
  if (!url) return NextResponse.json({ error: "No screenshot" }, { status: 404 });
  return NextResponse.redirect(url, { status: 302 });
}
