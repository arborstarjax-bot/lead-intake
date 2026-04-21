import { NextRequest, NextResponse } from "next/server";
import { ingestScreenshot } from "@/lib/ingest";
import { maybeConvertHeic } from "@/lib/convert-heic";
import { sendPushToAll, currentBadgeCount } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  const results: Array<{ fileName: string; originalFileName: string; lead_id: string; intake_status: string; duplicates: unknown[] }> = [];
  const errors: Array<{ fileName: string; error: string }> = [];

  for (const file of files) {
    try {
      const { blob, fileName } = await maybeConvertHeic(file, file.name);
      const res = await ingestScreenshot({
        file: blob,
        fileName,
        source: "web_upload",
      });
      results.push({ fileName, originalFileName: file.name, ...res });
    } catch (e) {
      errors.push({ fileName: file.name, error: (e as Error).message });
    }
  }

  if (results.length > 0) {
    try {
      const admin = createAdminClient();
      const { data: leads } = await admin
        .from("leads")
        .select("client, phone_number, intake_status")
        .in(
          "id",
          results.map((r) => r.lead_id)
        );
      const badgeCount = await currentBadgeCount();
      const pluralized = results.length === 1 ? "New lead" : `${results.length} new leads`;
      const first = leads?.[0];
      const body = first
        ? [first.client, first.phone_number].filter(Boolean).join(" · ") || "Open to review."
        : "Open to review.";
      await sendPushToAll({
        title: pluralized,
        body,
        url: "/leads",
        badgeCount,
        tag: "new-lead",
      });
    } catch {
      // Push is best-effort; never fail the upload response over it.
    }
  }

  return NextResponse.json({ results, errors });
}
