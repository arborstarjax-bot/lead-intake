import { createAdminClient } from "@/modules/shared/supabase/server";
import { extractLeadFromText } from "./ai/extract-text";
import { findDuplicates, isSaveable } from "@/modules/leads";
import { displayName, normalizeState, normalizeZip } from "@/modules/shared/format";
import { inferAddress, MapsUnavailableError } from "@/modules/routing/server";
import { type Lead } from "@/modules/leads/model";
import { getSettings } from "@/lib/settings";
import type { ExtractedLead } from "./ai/extract";
import type { IngestResult } from "./ingest";

type IngestTextArgs = {
  workspaceId: string;
  text: string;
  /** Fallback salesperson to attribute the lead to when the text
   *  doesn't include one. */
  defaultSalesperson?: string | null;
};

/**
 * Full text-paste ingestion pipeline:
 *  1. Send the pasted text to GPT-4o-mini for structured extraction.
 *  2. Backfill missing address parts via geocoding (same as image ingest).
 *  3. Persist the extracted lead row with per-field confidence.
 *  4. Flag the lead as `needs_review` if any critical field is low-confidence,
 *     or `ready` otherwise.
 *
 *  Every row is scoped to the caller's workspace.
 */
export async function ingestText(args: IngestTextArgs): Promise<IngestResult> {
  const admin = createAdminClient();

  let extracted: ExtractedLead;
  try {
    extracted = await extractLeadFromText(args.text);
  } catch (e) {
    const { data: failed, error: insertErr } = await admin
      .from("leads")
      .insert({
        workspace_id: args.workspaceId,
        status: "New",
        intake_source: "text_paste",
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

  await backfillMissingAddressParts(extracted);

  const wsSettings = await getSettings(args.workspaceId);
  const validatedSource: string | null =
    extracted.lead_source && wsSettings.lead_sources.includes(extracted.lead_source)
      ? extracted.lead_source
      : null;

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

  const lowConf = Object.entries(extracted.confidence).some(
    ([k, v]) =>
      (k === "phone_number" || k === "email") && v != null && v < 0.6 && (extracted as Record<string, unknown>)[k]
  );
  const saveable = isSaveable(extracted as unknown as Partial<Lead>);
  const intakeStatus: Lead["intake_status"] =
    !saveable || lowConf || duplicates.length > 0 ? "needs_review" : "ready";

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: wsSettings.timezone,
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
      sales_person: extracted.sales_person ?? args.defaultSalesperson ?? null,
      scheduled_day: extracted.scheduled_day,
      scheduled_time: extracted.scheduled_time,
      notes: extracted.notes,
      lead_source: validatedSource,
      extraction_confidence: extracted.confidence,
      intake_source: "text_paste",
      intake_status: intakeStatus,
    })
    .select("id, intake_status, created_at")
    .single();
  if (insertErr) throw insertErr;

  // Post-insert dedupe (same as image ingest)
  let postInsertDuplicates: ReturnType<typeof findDuplicates> = duplicates;
  let finalIntakeStatus: Lead["intake_status"] = inserted.intake_status;
  if (isSaveable(extracted as unknown as Partial<Lead>) && intakeStatus === "ready") {
    const { data: after } = await admin
      .from("leads")
      .select("id, first_name, last_name, phone_number, email, address, status, created_at")
      .eq("workspace_id", args.workspaceId)
      .neq("status", "Completed")
      .neq("id", inserted.id);
    const afterList = (after ?? []) as (Pick<
      Lead,
      "id" | "first_name" | "last_name" | "phone_number" | "email" | "address" | "status"
    > & { created_at: string })[];
    const raceDuplicates = findDuplicates(
      {
        phone_number: extracted.phone_number,
        email: extracted.email,
        first_name: extracted.first_name,
        last_name: extracted.last_name,
        address: extracted.address,
      },
      afterList
    );
    const ourCreatedAt = inserted.created_at;
    const ourId = inserted.id;
    const earlierHardMatch = raceDuplicates.some((m) => {
      if (m.reason !== "phone" && m.reason !== "email") return false;
      const match = afterList.find((r) => r.id === m.lead.id);
      if (!match) return false;
      if (match.created_at < ourCreatedAt) return true;
      if (match.created_at === ourCreatedAt && match.id < ourId) return true;
      return false;
    });
    if (earlierHardMatch) {
      const { error: updateErr } = await admin
        .from("leads")
        .update({ intake_status: "needs_review" })
        .eq("id", inserted.id)
        .eq("workspace_id", args.workspaceId);
      if (updateErr) throw updateErr;
      postInsertDuplicates = raceDuplicates;
      finalIntakeStatus = "needs_review";
    }
  }

  try {
    await admin.from("lead_activities").insert({
      workspace_id: args.workspaceId,
      lead_id: inserted.id,
      type: "lead_intake",
      details: { source: "text_paste", intake_status: finalIntakeStatus },
    });
  } catch {
    // Activity log is best-effort.
  }

  return {
    lead_id: inserted.id,
    intake_status: finalIntakeStatus,
    duplicates: postInsertDuplicates,
  };
}

/**
 * Same backfill logic as image ingest — fills missing address components
 * via Google Geocoding when we have enough signal.
 */
async function backfillMissingAddressParts(lead: ExtractedLead): Promise<void> {
  const haveAnchor =
    Boolean(lead.address?.trim()) || Boolean(lead.zip?.trim());
  if (!haveAnchor) return;

  const segs = [lead.address, lead.city, lead.state, lead.zip].filter(
    (s): s is string => Boolean(s && s.trim())
  );
  if (segs.length < 2) return;

  const needsInference =
    !lead.address || !lead.city || !lead.state || !lead.zip;
  if (!needsInference) return;

  let inferred;
  try {
    inferred = await inferAddress({
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
    });
  } catch (e) {
    if (!(e instanceof MapsUnavailableError)) {
      console.error("ingestText.backfillMissingAddressParts failed", e);
    }
    return;
  }
  if (!inferred) return;

  const conf = inferred.confidence;
  const confMap = lead.confidence as Record<string, number>;

  if (!lead.address && inferred.parts.address) {
    lead.address = inferred.parts.address;
    confMap.address = conf;
  }
  if (!lead.city && inferred.parts.city) {
    lead.city = inferred.parts.city;
    confMap.city = conf;
  }
  if (!lead.state && inferred.parts.state) {
    const st = normalizeState(inferred.parts.state) ?? inferred.parts.state;
    lead.state = st;
    confMap.state = conf;
  }
  if (!lead.zip && inferred.parts.zip) {
    const z = normalizeZip(inferred.parts.zip) ?? inferred.parts.zip;
    lead.zip = z;
    confMap.zip = conf;
  }
}
