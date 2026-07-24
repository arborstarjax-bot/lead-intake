/**
 * Lead-source resolution shared by the image and text extractors (and the
 * calendar-sync SingleOps path).
 *
 * The core idea: the workspace's *configured* lead sources
 * (`app_settings.lead_sources`, editable in Settings) are the source of
 * truth. We feed that exact list into the model prompt so it can return a
 * custom source (e.g. "10for300", "Pipeline Partners", "Go Get Leads")
 * instead of falling back to "Text Message", and we run a deterministic
 * keyword pass so a literal brand mention in the message always wins over
 * the messaging app the screenshot happens to be taken in.
 */

/**
 * Generic delivery/fallback sources whose *names* appear too often in
 * ordinary lead text to be matched literally (an email address contains
 * "email", any SMS is a "text message"). These are still valid values the
 * model may pick from context — we just don't let a bare keyword hit on
 * them win over a real brand mention.
 */
const GENERIC_SOURCES = new Set([
  "text message",
  "email",
  "other",
  "website form",
  "direct mail",
  "referral",
  "phone call",
  "sms",
  "call",
  "voicemail",
])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Strip a single trailing plural "s" so "Partners" matches "Partner". */
function stem(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token
}

function tokenize(source: string): string[] {
  return source.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

/**
 * Build a tolerant, contiguous-phrase matcher for a source name. Tokens are
 * stemmed and each may carry an optional trailing "s"; between tokens we
 * allow up to a few non-alphanumeric characters so "The Pipeline Partner"
 * matches "Pipeline Partners" but we don't match across unrelated spans.
 */
function sourcePattern(source: string): RegExp | null {
  const tokens = tokenize(source)
  if (tokens.length === 0) return null
  const body = tokens.map((t) => `${escapeRegExp(stem(t))}s?`).join("[^a-z0-9]{0,3}")
  return new RegExp(body, "i")
}

/**
 * Deterministically match the most specific configured source whose name
 * appears in `text`. Generic delivery sources are skipped. Returns the
 * source string exactly as configured, or null.
 */
export function matchLeadSourceKeyword(
  text: string | null | undefined,
  sources: string[],
): string | null {
  if (!text) return null
  const hay = text.toLowerCase()
  const candidates = sources
    .filter((s) => s.trim().length > 0 && !GENERIC_SOURCES.has(s.trim().toLowerCase()))
    // Prefer the most specific match: most tokens first, then longest name.
    .sort((a, b) => tokenize(b).length - tokenize(a).length || b.length - a.length)
  for (const source of candidates) {
    const re = sourcePattern(source)
    if (re && re.test(hay)) return source
  }
  return null
}

/**
 * Resolve the final lead source from the model's guess plus the raw text.
 *   1. A distinctive configured brand name found in the text wins.
 *   2. Otherwise trust the model only if it named a configured source
 *      (case-insensitive), returning the exact configured casing.
 *   3. Otherwise null — never invent a value outside the configured list.
 */
export function resolveLeadSource(
  modelValue: string | null | undefined,
  haystack: string | null | undefined,
  sources: string[],
): string | null {
  const configured = sources.filter((s) => s.trim().length > 0)
  const kw = matchLeadSourceKeyword(haystack, configured)
  if (kw) return kw
  const mv = modelValue?.trim().toLowerCase()
  if (mv) {
    const match = configured.find((s) => s.toLowerCase() === mv)
    if (match) return match
  }
  return null
}

/**
 * The `- Lead source:` section of the extraction system prompt, generated
 * from the workspace's configured sources so the model is never blind to a
 * custom source.
 */
export function buildSourcePromptSection(sources: string[]): string {
  const list = sources.filter((s) => s.trim().length > 0)
  const quoted = list.map((s) => `"${s}"`).join(", ")
  return `- Lead source: determine WHERE this lead ORIGINATED — the marketing
  channel, lead service, or brand that produced it — NOT the app used to
  deliver the message. A text forwarded from a lead service is that
  service's lead, NOT "Text Message".

  This workspace's configured lead sources are (you MUST return one of these
  values EXACTLY as written, case-sensitive):
    ${quoted}

  How to choose, in priority order:
    1. Scan the FULL content — message body, header, subject line,
       signature, and footer — for the name of any configured source above
       or an obvious variant of it. Examples: "The Pipeline Partner" ->
       "Pipeline Partners"; "Lead Kings" -> "Certified Lead Kings";
       "10for300", "Go Get Leads", "SingleOps", "Hubspot", "Target Tree",
       "Branch Up Digital", "Home Service Leads" map to their exact
       configured names. A brand / service name mentioned ANYWHERE always
       wins over the messaging app the screenshot was taken in.
    2. Otherwise classify by the visible app / UI chrome (Facebook,
       Instagram, Nextdoor, Thumbtack, Angi, Email, Website Form) — but only
       if that maps to one of the configured sources above.
    3. Only as a last resort, when the message is a plain SMS / iMessage
       with no identifiable service, use "Text Message" (if configured).
  Return exactly one of the configured values above, or null if none fit.
  Never invent a value that is not in the configured list.`
}
