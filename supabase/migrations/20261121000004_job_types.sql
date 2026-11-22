-- Editable per-workspace job types (like lead_sources) and the per-lead
-- job type value selected from them. Existing workspaces receive the
-- app's default list via the settings merge in getSettings().
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS job_types text[] NOT NULL DEFAULT '{}';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS job_type text;
