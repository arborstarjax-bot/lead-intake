import { createAdminClient } from "@/lib/supabase/server";
import { extractLeadFromImage } from "@/lib/ai/extract";
import { findDuplicates, isSaveable } from "@/lib/dedupe";
import { displayName } from "@/lib/format";
import type { Lead, LeadIntakeSource } from "@/lib/types";

const SCREENSHOT_BUCKET = "lead-screenshots";

type IngestArgs = {
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
 *  1. Upload the screenshot to Supabase Storage (private bucket).
 *  2. Create a short-lived signed URL and hand it to GPT-4o.
 *  3. Persist the extracted lead row with per-field confidence.
 *  4. Attach the screenshot path and (re-signable) public URL.
 *  5. Flag the lead as `needs_review` if any critical field is low-confidence,
 *     or `ready` otherwise. A lead with neither phone nor email is also
 *     marked `needs_review`, per the validation rule.
 */
export async function ingestScreenshot(args: IngestArgs): Promise<IngestResult> {
  const admin = createAdminClient();

  const ts = Date.now();
  const safeName = args.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${new Date().toISOString().slice(0, 10)}/${ts}-${safeName}`;

  const arrayBuffer = await args.file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, arrayBuffer, {
      contentType: args.file.type || "image/jpeg",
      upsert: false,
    });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // Sign URL for the LLM. 10 minutes is plenty; the call is synchronous.
  const { data: signed, error: signErr } = await admin.storage
    .from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, 600);
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Sign failed: ${signErr?.message}`);
  }

  let extracted;
  try {
    extracted = await extractLeadFromImage(signed.signedUrl);
  } catch (e) {
    // Persist a failed placeholder so the upload is not silently lost.
    const { data: failed, error: insertErr } = await admin
      .from("leads")
      .insert({
        status: "New",
        screenshot_path: path,
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

  // Duplicate detection against currently-active leads.
  const { data: activeLeads } = await admin
    .from("leads")
    .select("id, first_name, last_name, phone_number, email, address, status")
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
      screenshot_path: path,
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

/** Re-sign a screenshot URL for a row's `screenshot_path`. */
export async function signScreenshotUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
