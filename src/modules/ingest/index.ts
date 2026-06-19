// Client-safe barrel for the ingest module.
//
// Only UploadBox and TextPasteBox are exposed here. Orchestrator /
// rate-limit / AI extraction live under @/modules/ingest/server —
// mixing them in a single barrel drags server-only side effects into
// the client bundle.

export { default as UploadBox } from "./ui/UploadBox";
export { default as TextPasteBox } from "./ui/TextPasteBox";
