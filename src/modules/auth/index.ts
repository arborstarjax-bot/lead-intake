// Barrel for the auth module.
//
// Callers reach in through:
//   import { requireMembership, getSessionMembership } from "@/modules/auth";
//
// Auth helpers require server-side context (cookies, service role);
// they're re-exported from ./server/session and should not be imported
// from a client component. The eslint boundary exempts in-module
// imports, so ./server/* remains accessible from inside auth/.

export {
  getSessionMembership,
  requireMembership,
  requireAdmin,
  generateJoinCode,
  type WorkspaceMembership,
} from "./server/session";
