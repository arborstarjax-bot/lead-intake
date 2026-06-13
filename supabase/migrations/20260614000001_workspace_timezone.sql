-- Add timezone to app_settings so every workspace can set its own tz.
-- Defaults to America/New_York for existing workspaces.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York';
