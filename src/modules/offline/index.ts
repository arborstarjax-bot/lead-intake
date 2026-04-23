// Public surface of the offline module.
//
// Callers reach in through this barrel:
//   import { fetchWithOfflineQueue, patchLead } from "@/modules/offline";
//
// The owning module (anything under src/modules/offline/) may still
// import ./queue, ./patchLead, and ./ui/* directly; the eslint
// boundary rule exempts in-module imports.

export {
  fetchWithOfflineQueue,
  enqueueWrite,
  listPending,
  removeWrite,
  bumpAttempts,
  pendingCount,
  replayQueue,
  type QueuedWrite,
  type ReplaySummary,
} from "./queue";

export { patchLead, formatLeadPatchError } from "./patchLead";

export { OfflineQueueReplayer } from "./ui/OfflineQueueReplayer";
export { OfflineBanner } from "./ui/OfflineBanner";
