/**
 * Scope vocabulary for /api/v1 API keys.
 *
 * Kept in its own client-safe module (no server-only, no next/server)
 * so the settings UI can share the same list — a second copy drifted
 * once already and new keys silently lacked new scopes.
 */
export type ApiScope =
  | "leads:read" | "leads:write"
  | "tasks:read" | "tasks:write"
  | "schedule:read" | "schedule:write"
  | "workspace:read"
  | "settings:read" | "settings:write"
  | "members:write"
  | "reports:read"
  | "webhooks:manage";

export const ALL_SCOPES: ApiScope[] = [
  "leads:read", "leads:write",
  "tasks:read", "tasks:write",
  "schedule:read", "schedule:write",
  "workspace:read", "settings:read", "settings:write",
  "members:write", "reports:read",
  "webhooks:manage",
];
