import { NextRequest, NextResponse } from "next/server";
import { ingestScreenshot } from "@/lib/ingest";
import { maybeConvertHeic } from "@/lib/convert-heic";
import { safeCompare } from "@/lib/utils";
import { sendNewLeadPush } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const expected = process.env.LEAD_INTAKE_UPLOAD_TOKEN ?? "";
  if (!expected || !safeCompare(token, expected)) {
    return NextResponse.json({ error: "Invalid upload link" }, { status: 403 });
  }

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files" }, { status: 400 });
  }

  const results: Array<{
    fileName: string;
    originalFileName: string;
    lead_id: string;
    intake_status: string;
    duplicates: unknown[];
    lead?: Lead;
  }> = [];
  const errors: Array<{ fileName: string; error: string }> = [];
  for (const file of files) {
    try {
      const { blob, fileName } = await maybeConvertHeic(file, file.name);
      const res = await ingestScreenshot({
        file: blob,
        fileName,
        source: "quick_link",
      });
      results.push({ fileName, originalFileName: file.name, ...res });
    } catch (e) {
      errors.push({ fileName: file.name, error: (e as Error).message });
    }
  }

  if (results.length > 0) {
    const admin = createAdminClient();
    try {
      const { data: createdLeads } = await admin
        .from("leads")
        .select("*")
        .in("id", results.map((r) => r.lead_id));
      if (createdLeads) {
        const byId = new Map((createdLeads as Lead[]).map((l) => [l.id, l]));
        for (const r of results) {
          const lead = byId.get(r.lead_id);
          if (lead) r.lead = lead;
        }
      }
    } catch {
      // Non-fatal: client still has lead_id.
    }
    try {
      const latest = results[results.length - 1]?.lead;
      const latestLead = latest
        ? { client: latest.client, phone_number: latest.phone_number }
        : null;
      await sendNewLeadPush({ latestLead });
    } catch {}
  }

  return NextResponse.json({ results, errors });
}
