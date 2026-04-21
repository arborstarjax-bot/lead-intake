import OpenAI from "openai";
import {
  normalizeEmail,
  normalizePhone,
  normalizeState,
  normalizeZip,
} from "@/lib/format";

/**
 * Structured extraction result. Confidence is 0..1 per field; a field is
 * flagged for review in the UI when confidence < 0.6 or when the value
 * is present but we can't validate it (e.g. malformed phone/email).
 */
export type ExtractedLead = {
  date: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sales_person: string | null;
  scheduled_day: string | null;
  scheduled_time: string | null;
  notes: string | null;
  confidence: Record<string, number>;
};

const SYSTEM_PROMPT = `You extract lead/estimate-request contact info from phone screenshots.

Sources vary: iMessage threads, SMS, Facebook, Instagram DMs, Nextdoor, Thumbtack,
Angi, Google Lead Forms, voicemail transcriptions, handwritten notes, emails, etc.

Rules:
- Extract ONLY what is clearly visible or strongly implied. Never invent data.
- Names: you MUST look everywhere in the image for the lead's name. Do not give
  up if the message body omits it. Always scan ALL of these locations, in this
  priority order, and use the first one that yields a person name:
    1. Explicit self-introduction in message body ("Hi, this is Jane Doe…").
    2. Signed name at the end of a message ("- Jane", "Thanks, Jane Doe").
    3. The contact/thread header of a messaging app. This is almost always the
       lead's name when the screenshot is a conversation. Look for:
         - Facebook/Instagram/Messenger: the name in the top bar above messages,
           or under the profile avatar on a profile card.
         - iMessage / SMS / WhatsApp / Signal: the name at the very top of the
           thread (not a phone number — if only a number is shown, leave name
           null).
         - Any chat UI: a name next to or directly above each incoming bubble.
    4. Call log / voicemail screens: the caller's name shown above the number.
    5. Email headers: "From: Jane Doe <jane@x.com>" — extract the display name.
    6. Contact cards ("tap for info" panels) that reveal first + last name.
    7. Handwritten notes: any name written near the contact info.
  Split into first_name and last_name. If only one token is present, put it in
  first_name and leave last_name null. If a middle initial is shown, keep it
  with first_name ("Jane M."). If the thread header is obviously a business /
  page name ("Acme Roofing", "Mike's Plumbing"), leave first_name/last_name
  null rather than using the business name. Never invent a name, but DO use
  the header name when it's a plausible person name — that is what the lead
  is called.
- Phone: return in any form; downstream code normalizes to E.164.
- Address: street only (no city/state/zip); put those in their own fields.
- State: return 2-letter USPS abbreviation (e.g. "FL") when possible.
- Scheduled day: ISO date "YYYY-MM-DD" if a specific date is shown or strongly
  implied (e.g. "Tue Apr 22" when a year is visible/inferrable from context).
  Use null if only a vague day like "tomorrow" is mentioned.
- Scheduled time: 24-hour "HH:MM" if specific time is present; otherwise null.
- Notes: a concise free-text summary of useful context the rep should see
  before calling: job description/requested service, urgency, best time to
  call, scheduling preferences, gate codes, referral source, apartment #,
  pets, access notes. Do NOT restate fields already captured above.
- Confidence: 0.0–1.0 for each field, reflecting how certain you are from the
  image. A field that is absent from the image should be null with confidence 0.

Return JSON matching the provided schema exactly. Do not add commentary.`;

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
    "confidence",
  ],
} as const;

/**
 * Send an image (as a publicly-reachable or data URL) to GPT-4o and extract
 * a structured lead record. The caller is responsible for uploading the
 * screenshot to storage first and generating a signed URL for it.
 */
const NAME_FALLBACK_PROMPT = `You are looking at a screenshot that was already parsed once and
the lead's name came back empty. The name is almost always present — it
just wasn't spotted. Focus exclusively on finding the person's name.

Prioritize these regions in order:
  1. The very top of the screen — the chat/thread header of Facebook
     Messenger, Instagram DMs, iMessage, SMS, WhatsApp. The large text
     centered at the top of a conversation is the other person's name.
  2. Profile card overlays ("tap for info" panels) showing first + last.
  3. Incoming message bubbles with a name label above them.
  4. Signed names at the end of a message ("- Jane", "Thanks, Jane Doe").
  5. Email "From" display names.
  6. Call log / voicemail "from" labels.

If the top-bar name looks like a business/page ("Acme Roofing",
"Mike's Plumbing"), leave first_name/last_name null — do not invent.
Otherwise, use the header name; a messaging-app thread header IS the
lead's name. Split a two-token name into first + last; a single token
goes in first_name with last_name null.

Return JSON matching the schema. Do not explain.`;

const NAME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    first_name: { type: ["string", "null"] },
    last_name: { type: ["string", "null"] },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        first_name: { type: "number" },
        last_name: { type: "number" },
      },
      required: ["first_name", "last_name"],
    },
  },
  required: ["first_name", "last_name", "confidence"],
} as const;

type NameFallback = {
  first_name: string | null;
  last_name: string | null;
  confidence: { first_name: number; last_name: number };
};

async function extractNameFromImage(
  client: OpenAI,
  imageUrl: string
): Promise<NameFallback | null> {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "name_only", strict: true, schema: NAME_SCHEMA },
      },
      messages: [
        { role: "system", content: NAME_FALLBACK_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Find the lead's name in this screenshot. Check the thread header first.",
            },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;
    return JSON.parse(raw) as NameFallback;
  } catch {
    // Fallback is best-effort: never fail the ingestion over it.
    return null;
  }
}

export async function extractLeadFromImage(imageUrl: string): Promise<ExtractedLead> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "extracted_lead",
        strict: true,
        schema: SCHEMA,
      },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the lead from this screenshot." },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty extraction");

  const parsed = JSON.parse(raw) as ExtractedLead;

  // Vision is non-deterministic. If the first pass missed the name
  // entirely, retry with a prompt focused solely on the chat header.
  // Only escalate when we also see signs of identifiable content (a
  // phone, email, address, or message notes) — no-signal screenshots
  // shouldn't burn a second call.
  const hasAnyContent =
    !!parsed.phone_number ||
    !!parsed.email ||
    !!parsed.address ||
    !!parsed.notes;
  if (!parsed.first_name && hasAnyContent) {
    const fallback = await extractNameFromImage(client, imageUrl);
    if (fallback?.first_name) {
      parsed.first_name = fallback.first_name;
      parsed.last_name = fallback.last_name ?? parsed.last_name;
      parsed.confidence = {
        ...parsed.confidence,
        first_name: fallback.confidence?.first_name ?? 0.7,
        last_name: fallback.confidence?.last_name ?? 0,
      };
    }
  }

  // Post-normalize: format normalization increases downstream value without
  // distorting the model's original confidence numbers.
  return {
    ...parsed,
    phone_number: normalizePhone(parsed.phone_number) ?? parsed.phone_number,
    email: normalizeEmail(parsed.email) ?? parsed.email,
    state: normalizeState(parsed.state) ?? parsed.state,
    zip: normalizeZip(parsed.zip) ?? parsed.zip,
  };
}
