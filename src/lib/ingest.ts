import { createAdminClient } from "@/modules/shared/supabase/server";
import { extractLeadFromImage } from "@/lib/ai/extract";
import { findDuplicates, isSaveable } from "@/modules/leads";
import { displayName } from "@/modules/shared/format";
import type { Lead, LeadIntakeSource } from "@/modules/leads/model";

type IngestArgs = {
  workspaceId: string;
  file: Blob;
  fileName: string;
  source: LeadIntakeSource;
  /** Fallback salesperson to attribute the lead to when the screenshot
   *  doesn't include one (e.g. creator's email on manual uploads). */
  defaultSalesperson?: string | null;
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
      sales_person: extracted.sales_person ?? args.defaultSalesperson ?? null,
      scheduled_day: extracted.scheduled_day,
      scheduled_time: extracted.scheduled_time,
      notes: extracted.notes,
      extraction_confidence: extracted.confidence,
      intake_source: args.source,
      intake_status: intakeStatus,
    })
    .select("id, intake_status, created_at")
    .single();
  if (insertErr) throw insertErr;

  // Post-insert dedupe sweep. The pre-insert check can miss a duplicate
  // when two uploads of the same lead race each other — both read an
  // active-lead list that doesn't yet contain the other, both pass the
  // check, and both insert. Re-query now that our own row is in place
  // and look for anything that matches on phone / email (the hard
  // criteria). If a match exists AND was created earlier than ours,
  // we lost the race: demote to needs_review so the user sees the
  // dupe warning instead of the new row silently going "ready".
  let postInsertDuplicates: ReturnType<typeof findDuplicates> = duplicates;
  let finalIntakeStatus: Lead["intake_status"] = inserted.intake_status;
  if (isSaveable(extracted) && intakeStatus === "ready") {
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
    // Only consider HARD matches (phone/email) for the race check. Name
    // / address collisions are soft warnings that should stay as warnings
    // regardless of insert order. And only demote when the colliding row
    // pre-dates ours — otherwise two simultaneous inserts would both
    // demote each other and the user sees no "ready" row at all.
    const ourCreatedAt = inserted.created_at;
    const ourId = inserted.id;
    const earlierHardMatch = raceDuplicates.some((m) => {
      if (m.reason !== "phone" && m.reason !== "email") return false;
      const match = afterList.find((r) => r.id === m.lead.id);
      if (!match) return false;
      if (match.created_at < ourCreatedAt) return true;
      // Two inserts committed within the same microsecond have identical
      // created_at and neither was strictly "earlier" — without a
      // tiebreaker both rows stayed `ready` and the user saw a duplicate
      // pair. Fall back to id (uuid-lex order) so exactly one side
      // demotes itself; the other stays ready and surfaces as the
      // canonical lead.
      if (match.created_at === ourCreatedAt && match.id < ourId) return true;
      return false;
    });
    if (earlierHardMatch) {
      // Demote in DB first; only mutate the response state if the
      // update actually lands. Otherwise we'd return needs_review +
      // the duplicate list while the row stays `ready` in the DB —
      // the API route re-fetches the lead to build the response, so
      // the client would see contradictory intake_status values on
      // the same lead in the same payload.
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
      details: { source: args.source, intake_status: finalIntakeStatus },
    });
  } catch {
    // Activity log is best-effort; a failure here must not break intake.
  }

  return {
    lead_id: inserted.id,
    intake_status: finalIntakeStatus,
    duplicates: postInsertDuplicates,
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
