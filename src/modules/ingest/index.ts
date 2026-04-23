// Barrel for the ingest module.
//
// Ingest is the screenshot \u2192 OpenAI \u2192 lead row pipeline plus the
// manual-paste path. Everything under server/ is server-only:
// `ingest.ts` owns the orchestrator (dedupe, rate-limit gate,
// AI extract + refund on failure, signed-URL helper); `rateLimit.ts`
// is the in-memory pre-filter paired with the DB RPC counter;
// `ai/extract.ts` is the OpenAI Vision call.
//
// UploadBox is the /#/ home-page drag-drop UI driving POST /api/ingest.

export {
  ingestScreenshot,
  signScreenshotUrl,
  type IngestResult,
} from "./server/ingest";

export {
  checkRateLimit,
  refundRateLimit,
  rateLimitKey,
  type RateLimitResult,
} from "./server/rateLimit";

export {
  extractLeadFromImage,
  type ExtractedLead,
} from "./server/ai/extract";

export { default as UploadBox } from "./ui/UploadBox";
