// Server-only surface of the routing module.
//
// Kept in a dedicated sub-barrel (@/modules/routing/server) so the
// main barrel (@/modules/routing) can stay client-safe. Reason:
// ./maps and ./geocode both have `import "server-only"` at the top,
// and re-exporting them from the module's main index.ts creates a
// module-graph edge from any client component that imports anything
// from the barrel — webpack then pulls the side-effect import into
// the client bundle and the build fails.
//
// Server callers: api/schedule/* route handlers, modules/schedule/
// server/schedule.ts, anything else that needs drive-time / geocode.

import "server-only";

export {
  getDriveTime,
  getDriveMatrix,
  createDriveMemo,
  MapsUnavailableError,
  type DriveResult,
} from "./maps";

export {
  geocode,
  geocodeMany,
  type LatLng,
} from "./geocode";

export {
  inferAddress,
  buildInferenceQuery,
  type AddressParts,
  type InferredAddress,
} from "./infer-address";
