// Server-only surface of the ingest module.
//
// Split out from @/modules/ingest so the main barrel can stay client-
// safe. ingest.ts pulls in @/modules/shared/supabase/server which has
// `import "server-only"`; re-exporting from it in the main barrel
// would drag the side-effect import into every client bundle that
// imports UploadBox.
//
// checkRateLimit / refundRateLimit / rateLimitKey are technically
// process-local and have no server-only side effects, but they're
// paired with the DB-backed atomic counter at the API route boundary;
// keeping them co-located in the server sub-barrel keeps the public
// surface tidy.
//
// `import "server-only"` at the top matches the convention of every
// other server sub-barrel in the codebase — it's the guard that turns
// an accidental client-side import into a loud build failure rather
// than a silent bundle bloat (rateLimit.ts / ai/extract.ts would
// otherwise bundle cleanly into a client chunk).

import "server-only";

export {
  ingestScreenshot,
  signScreenshotUrl,
  type IngestResult,
} from "./ingest";

export {
  checkRateLimit,
  refundRateLimit,
  rateLimitKey,
  type RateLimitResult,
} from "./rateLimit";

export {
  extractLeadFromImage,
  type ExtractedLead,
} from "./ai/extract";
