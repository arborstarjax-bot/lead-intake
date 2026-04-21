-- Corrective backfill for status_changed_at.
--
-- The initial migration (20260421000004_lost_status.sql) added
-- status_changed_at with DEFAULT now(), which stamps every existing row
-- with the moment the migration ran. Its backfill clause
-- `WHERE status_changed_at = created_at` never matched (the just-assigned
-- DEFAULT now() never equals created_at), so all pre-existing rows kept
-- status_changed_at at migration time instead of their real last-edit time.
--
-- Effect of the bug: a "Called / No Response" lead that had been stale for
-- 60 days before migration wouldn't be swept to "Lost" until 30 days
-- *after* the migration runs.
--
-- This migration backfills correctly. The predicate
-- `status_changed_at > updated_at` is only true for rows that have NOT
-- had any field touched since the migration ran (i.e. the default is still
-- in place). Rows whose status has actually changed post-migration have
-- `status_changed_at = updated_at` (both bumped by the trigger / same
-- UPDATE) and are left alone. Idempotent — safe to re-run.

update public.leads
set status_changed_at = updated_at
where status_changed_at > updated_at;
