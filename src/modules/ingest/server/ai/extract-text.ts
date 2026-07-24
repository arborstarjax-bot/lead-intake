import OpenAI from "openai";
import {
  normalizeEmail,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from "@/modules/shared/format";
import type { ExtractedLead } from "./extract";
import { buildSourcePromptSection, resolveLeadSource } from "./lead-source";

function buildSystemPrompt(leadSources: string[]): string {
  return `You extract lead/estimate-request contact info from plain text messages.

Sources vary: copy-pasted texts from iMessage, SMS, Facebook, Instagram DMs, Nextdoor, Thumbtack,
Angi, Google Lead Forms, voicemail transcriptions, emails, CRM notifications, etc.

Rules:
- Extract ONLY what is clearly present or strongly implied in the text. Never invent data.
- Names: look for the lead's name anywhere in the text. Check:
    1. Explicit mention ("Name: Jane Doe", "New Lead From ... for Jane Doe").
    2. Self-introduction ("Hi, this is Jane Doe…").
    3. Signed name at the end ("- Jane", "Thanks, Jane Doe").
    4. Header/subject lines that include the person's name.
  Split into first_name and last_name. If only one token is present, put it in
  first_name and leave last_name null.
- Phone: return in any form; downstream code normalizes to E.164.
- Address: street only (no city/state/zip); put those in their own fields.
- State: return 2-letter USPS abbreviation (e.g. "FL") when possible.
- Scheduled day: ISO date "YYYY-MM-DD" if a specific date is shown or strongly
  implied. Use null if only a vague day like "tomorrow" is mentioned.
- Scheduled time: 24-hour "HH:MM" if specific time is present; otherwise null.
- Notes: a concise free-text summary of useful context the rep should see
  before calling: job description/requested service, urgency, best time to
  call, scheduling preferences, gate codes, referral source, apartment #,
  pets, access notes. Do NOT restate fields already captured above.
${buildSourcePromptSection(leadSources)}
- Confidence: 0.0–1.0 for each field, reflecting how certain you are from the
  text. A field that is absent from the text should be null with confidence 0.

Return JSON matching the provided schema exactly. Do not add commentary.`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: ["string", "null"] },
    first_name: { type: ["string", "null"] },
    last_name: { type: ["string", "null"] },
    phone_number: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    zip: { type: ["string", "null"] },
    sales_person: { type: ["string", "null"] },
    scheduled_day: { type: ["string", "null"] },
    scheduled_time: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    lead_source: { type: ["string", "null"] },
    confidence: {
      type: "object",
      additionalProperties: { type: "number" },
      properties: {
        date: { type: "number" },
        first_name: { type: "number" },
        last_name: { type: "number" },
        phone_number: { type: "number" },
        email: { type: "number" },
        address: { type: "number" },
        city: { type: "number" },
        state: { type: "number" },
        zip: { type: "number" },
        sales_person: { type: "number" },
        scheduled_day: { type: "number" },
        scheduled_time: { type: "number" },
        notes: { type: "number" },
        lead_source: { type: "number" },
      },
      required: [
        "date",
        "first_name",
        "last_name",
        "phone_number",
        "email",
        "address",
        "city",
        "state",
        "zip",
        "sales_person",
        "scheduled_day",
        "scheduled_time",
        "notes",
        "lead_source",
      ],
    },
  },
  required: [
    "date",
    "first_name",
    "last_name",
    "phone_number",
    "email",
    "address",
    "city",
    "state",
    "zip",
    "sales_person",
    "scheduled_day",
    "scheduled_time",
    "notes",
    "lead_source",
    "confidence",
  ],
} as const;

const TIMEOUT_MS = 30_000;

/**
 * Send plain text (a pasted message / lead notification) to GPT-4o and
 * extract a structured lead record. Uses the same schema as image
 * extraction but with a text-optimized system prompt.
 */
export async function extractLeadFromText(
  text: string,
  leadSources: string[] = [],
): Promise<ExtractedLead> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  const response = await client.chat.completions.create(
    {
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 900,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_lead",
          strict: true,
          schema: SCHEMA,
        },
      },
      messages: [
        { role: "system", content: buildSystemPrompt(leadSources) },
        {
          role: "user",
          content: `Extract the lead from this text message:\n\n${text}`,
        },
      ],
    },
    { timeout: TIMEOUT_MS }
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty extraction");

  const parsed = JSON.parse(raw) as ExtractedLead;

  // Resolve against the workspace's configured sources using the full
  // pasted text — a literal brand mention wins over a generic guess.
  parsed.lead_source = resolveLeadSource(parsed.lead_source, text, leadSources);

  return {
    ...parsed,
    phone_number: normalizePhone(parsed.phone_number) ?? parsed.phone_number,
    email: normalizeEmail(parsed.email) ?? parsed.email,
    state: normalizeState(parsed.state) ?? parsed.state,
    zip: normalizeZip(parsed.zip) ?? parsed.zip,
  };
}
