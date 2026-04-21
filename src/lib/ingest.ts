import { createAdminClient } from "@/lib/supabase/server";
import { extractLeadFromImage } from "@/lib/ai/extract";
import { findDuplicates, isSaveable } from "@/lib/dedupe";
import { displayName } from "@/lib/format";
import type { Lead, LeadIntakeSource } from "@/lib/types";

type IngestArgs = {
  workspaceId: string;
  file: Blob;
  fileName: string;
  source: LeadIntakeSource;
};

export type IngestResult = {
  lead_id: string;
  intake_status: Lead["intake_status"];
  duplicates: ReturnType<typeof findDuplicates>;
};

/**
 * Full ingestion pipeline:
 *  1. Encode the screenshot as a base64 data URL and hand it to GPT-4o.
 *     We deliberately do NOT persist the image — the only value it adds
 *     after extraction is as a manual audit artifact, and storing every
 *     screenshot forever balloons Supabase Storage usage.
 *  2. Persist the extracted lead row with per-field confidence.
 *  3. Flag the lead as `needs_review` if any critical field is low-confidence,
 *     or `ready` otherwise. A lead with neither phone nor email is also
 *     marked `needs_review`, per the validation rule.
 *
 *  Every row is scoped to the caller's workspace.
 */
export async function ingestScreenshot(args: IngestArgs): Promise<IngestResult> {
  const admin = createAdminClient();

  const arrayBuffer = await args.file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mime = args.file.type || "image/jpeg";
  const dataUrl = `data:${mime};base64,${base64}`;

  let extracted;
  try {
    extracted = await extractLeadFromImage(dataUrl);
  } catch (e) {
    // Persist a failed placeholder so the upload is not silently lost.
    const { data: failed, error: insertErr } = await admin
      .from("leads")
      .insert({
        workspace_id: args.workspaceId,
        status: "New",
        intake_source: args.source,
        intake_status: "failed",
        notes: `AI extraction failed: ${(e as Error).message}`,
      })
      .select("id, intake_status")
      .single();
    if (insertErr) throw insertErr;
    return {
      lead_id: failed.id,
      intake_status: failed.intake_status,
      duplicates: [],
    };
  }

  // Duplicate detection against currently-active leads in THIS workspace.
  const { data: activeLeads } = await admin
    .from("leads")
    .select("id, first_name, last_name, phone_number, email, address, status")
    .eq("workspace_id", args.workspaceId)
    .neq("status", "Completed");
  const duplicates = findDuplicates(
    {
      phone_number: extracted.phone_number,
      email: extracted.email,
      first_name: extracted.first_name,
      last_name: extracted.last_name,
      address: extracted.address,
    },
    activeLeads ?? []
  );

  // Decide intake_status: needs_review if we can't save, otherwise ready.
  const lowConf = Object.entries(extracted.confidence).some(
    ([k, v]) =>
      (k === "phone_number" || k === "email") && v != null && v < 0.6 && (extracted as Record<string, unknown>)[k]
  );
  const saveable = isSaveable(extracted);
  const intakeStatus: Lead["intake_status"] =
    !saveable || lowConf || duplicates.length > 0 ? "needs_review" : "ready";

  // en-CA locale yields "YYYY-MM-DD". Vercel runs in UTC, so compute today
  // in the app's fixed timezone (America/New_York) — otherwise after ~8 PM ET
  // we'd stamp tomorrow's date on every upload.
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const { data: inserted, error: insertErr } = await admin
    .from("leads")
    .insert({
      workspace_id: args.workspaceId,
      date: extracted.date ?? today,
      first_name: extracted.first_name,
      last_name: extracted.last_name,
      client: displayName(extracted.first_name, extracted.last_name) || null,
      phone_number: extracted.phone_number,
      email: extracted.email,
      address: extracted.address,
      city: extracted.city,
      state: extracted.state,
      zip: extracted.zip,
      status: "New",
      sales_person: extracted.sales_person,
      scheduled_day: extracted.scheduled_day,
      scheduled_time: extracted.scheduled_time,
      notes: extracted.notes,
      extraction_confidence: extracted.confidence,
      intake_source: args.source,
      intake_status: intakeStatus,
    })
    .select("id, intake_status")
    .single();
  if (insertErr) throw insertErr;

  return {
    lead_id: inserted.id,
    intake_status: inserted.intake_status,
    duplicates,
  };
}

/**
 * Re-sign a screenshot URL for legacy rows that were ingested when we
 * still persisted the image. New rows have `screenshot_path = null` and
 * this function short-circuits for them.
 */
const LEGACY_SCREENSHOT_BUCKET = "lead-screenshots";
export async function signScreenshotUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(LEGACY_SCREENSHOT_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
