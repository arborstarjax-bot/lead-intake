import OpenAI from "openai";

const VALID_SOURCES = [
  "Hubspot",
  "Target Tree",
  "Facebook",
  "Instagram",
  "Google Ads",
  "Website Form",
  "Nextdoor",
  "Thumbtack",
  "Angi",
  "Close AI",
  "Certified Lead Kings",
  "Craigslist",
  "Email",
  "Referral",
  "Direct Mail",
  "Text Message",
  "SingleOps",
] as const;

const SYSTEM_PROMPT = `You are a lead source classifier for a tree care company. Given notes from a SingleOps task, determine which marketing source generated this lead.

Valid sources: ${VALID_SOURCES.join(", ")}

Rules:
- Look for explicit mentions of platforms (e.g. "Hubspot", "Facebook", "Nextdoor")
- "Target Tree" refers to the company's own direct mail/flyer/door-to-door marketing. Clues: "letter", "flyer", "mailer", "doorstep", "door hanger", "got something in the mail", "received a letter", "Target Tree"
- "Close AI" or "AI Agent" or "AI Call" refers to AI-powered phone calls
- "Referral" or "referred by" means a personal referral
- "Direct Mail" is generic mail marketing (not Target Tree branded)
- If the notes mention multiple sources, pick the PRIMARY one that generated the lead
- If you cannot determine the source, respond with "SingleOps"

Respond with ONLY the source name, nothing else.`;

/**
 * Use GPT-4o-mini to detect the lead source from SingleOps task notes.
 * Falls back to "SingleOps" if notes are empty or AI call fails.
 */
export async function detectLeadSource(notes: string | null | undefined): Promise<string> {
  if (!notes || notes.trim().length === 0) return "SingleOps";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "SingleOps";

  try {
    const client = new OpenAI({ apiKey, timeout: 10_000, maxRetries: 1 });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 20,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: notes },
      ],
    });

    const result = response.choices[0]?.message?.content?.trim() || "SingleOps";

    // Validate the response is a known source
    const matched = VALID_SOURCES.find(
      (s) => s.toLowerCase() === result.toLowerCase()
    );
    return matched || "SingleOps";
  } catch (err) {
    console.error("[calendar-sync] AI lead source detection failed:", err);
    return "SingleOps";
  }
}
