// Client-safe barrel for the ingest module.
//
// Only UploadBox (the drag-drop screenshot uploader on /) is exposed
// here. Orchestrator / rate-limit / AI extraction live under
// @/modules/ingest/server — mixing them in a single barrel drags
// server-only side effects into the client bundle.

export { default as UploadBox } from "./ui/UploadBox";
