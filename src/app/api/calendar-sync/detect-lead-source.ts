import OpenAI from "openai";
import { matchLeadSourceKeyword } from "@/modules/ingest/server";

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
 * Quick keyword scan for high-confidence source matches.
 * Catches patterns the AI might miss (e.g. "Target TreeAmy" where
 * the rep name is concatenated with no separator).
 */
function keywordMatch(text: string): string | null {
  const lower = text.toLowerCase();
  if (/target\s*tree/i.test(text)) return "Target Tree";
  if (lower.includes("hubspot")) return "Hubspot";
  if (lower.includes("nextdoor")) return "Nextdoor";
  if (lower.includes("thumbtack")) return "Thumbtack";
  if (/\bangi\b/.test(lower)) return "Angi";
  if (lower.includes("close ai") || lower.includes("ai agent") || lower.includes("ai call")) return "Close AI";
  if (lower.includes("certified lead kings")) return "Certified Lead Kings";
  if (lower.includes("craigslist")) return "Craigslist";
  if (/\bfacebook\b/.test(lower)) return "Facebook";
  if (/\binstagram\b/.test(lower)) return "Instagram";
  if (/\bgoogle\s*ads?\b/.test(lower)) return "Google Ads";
  return null;
}

/**
 * Check if the last line of notes is a known lead source.
 * ArborBridge appends the lead source on its own line when pushing to
 * SingleOps, so we can recover it here on pull-back without AI.
 */
function lastLineSource(text: string): string | null {
  const lines = text.split(/[\n\r]+|<br\s*\/?>/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const lastLine = lines[lines.length - 1];
  const matched = VALID_SOURCES.find(
    (s) => s.toLowerCase() === lastLine.toLowerCase()
  );
  return matched && matched !== "SingleOps" ? matched : null;
}

/**
 * Use GPT-4o-mini to detect the lead source from SingleOps task notes.
 * Falls back to keyword matching, then "SingleOps" if notes are empty or AI call fails.
 */
export async function detectLeadSource(
  notes: string | null | undefined,
  configuredSources: string[] = [],
): Promise<string> {
  if (!notes || notes.trim().length === 0) return "SingleOps";

  // Check last line for explicit lead source (appended by ArborBridge push)
  const lastLine = lastLineSource(notes);
  if (lastLine) return lastLine;

  // Prefer an exact hit against the workspace's *configured* sources so
  // custom sources (e.g. "10for300", "Pipeline Partners", "Go Get Leads")
  // are recognized, not just the built-in defaults below.
  const configuredHit = matchLeadSourceKeyword(notes, configuredSources);
  if (configuredHit) return configuredHit;

  // Try keyword match first for reliable detection of concatenated names
  const kw = keywordMatch(notes);
  if (kw) return kw;

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
