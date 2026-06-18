import OpenAI from "openai";

export type ExtractedTask = {
  name: string | null;
  notes: string | null;
  start_date: string | null;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  assignee: string | null;
  confidence: Record<string, number>;
};

const SYSTEM_PROMPT = `You extract task/appointment information from uploaded documents, images, and screenshots.

Sources vary: work orders, inspection notices, meeting invitations, calendar screenshots, handwritten notes, emails, PDFs, site visit confirmations, callback reminders, etc.

Rules:
- Extract ONLY what is clearly visible or strongly implied. Never invent data.
- name: A short descriptive name for the task (e.g. "Tree inspection", "Client callback", "Site visit").
- notes: Useful context about the task purpose, instructions, or details. Do NOT restate fields already captured.
- start_date: ISO date "YYYY-MM-DD" if a specific date is shown.
- start_time: 24-hour "HH:MM" if a specific start time is present.
- end_date: ISO date if an end date is shown (often same as start_date).
- end_time: 24-hour "HH:MM" if an end time is present.
- address: Street address only (no city/state/zip); put those in their own fields.
- state: Return 2-letter USPS abbreviation when possible.
- assignee: The person assigned to the task, if mentioned.
- Confidence: 0.0–1.0 for each field, reflecting certainty from the document. A field absent from the document should be null with confidence 0.

Return JSON matching the provided schema exactly. Do not add commentary.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    start_date: { type: ["string", "null"] },
    start_time: { type: ["string", "null"] },
    end_date: { type: ["string", "null"] },
    end_time: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    zip: { type: ["string", "null"] },
    assignee: { type: ["string", "null"] },
    confidence: {
      type: "object",
      additionalProperties: { type: "number" },
      properties: {
        name: { type: "number" },
        notes: { type: "number" },
        start_date: { type: "number" },
        start_time: { type: "number" },
        end_date: { type: "number" },
        end_time: { type: "number" },
        address: { type: "number" },
        city: { type: "number" },
        state: { type: "number" },
        zip: { type: "number" },
        assignee: { type: "number" },
      },
      required: [
        "name", "notes", "start_date", "start_time",
        "end_date", "end_time", "address", "city",
        "state", "zip", "assignee",
      ],
    },
  },
  required: [
    "name", "notes", "start_date", "start_time",
    "end_date", "end_time", "address", "city",
    "state", "zip", "assignee", "confidence",
  ],
} as const;

const TIMEOUT_MS = 45_000;

export async function extractTaskFromImage(imageUrl: string): Promise<ExtractedTask> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create(
    {
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 800,
      response_format: {
        type: "json_schema",
        json_schema: { name: "task_extraction", strict: true, schema: SCHEMA },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract task/appointment details from this document.",
            },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
    },
    { timeout: TIMEOUT_MS },
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty AI response");
  return JSON.parse(raw) as ExtractedTask;
}
