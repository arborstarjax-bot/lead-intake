// Server-only surface of the auth module.
//
// Session-backed membership lookup. session.ts has
// `import "server-only"` at the top, so we expose it only through
// this sub-barrel — the module's main barrel has no client-safe
// exports at all (and would be a bundle hazard if it did).

import "server-only";

export {
  getSessionMembership,
  requireMembership,
  requireAdmin,
  generateJoinCode,
  type WorkspaceMembership,
} from "./session";
