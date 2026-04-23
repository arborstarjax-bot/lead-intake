// Barrel for cross-cutting primitives that every module is allowed to
// reach into. Keep this surface SMALL — no business logic, no domain
// types (Lead / Subscription / Schedule belong in their own modules).
// Supabase clients live at `@/modules/shared/supabase/{client,server,
// middleware}` rather than being re-exported here, because pulling one
// of the admin clients into an accidental client-component import is
// worth catching at the import statement.

export * from "./format";
export * from "./date";
