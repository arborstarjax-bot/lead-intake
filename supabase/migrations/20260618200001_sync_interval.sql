-- Add configurable sync interval (minutes) to workspace settings
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS sync_interval_minutes INTEGER NOT NULL DEFAULT 15;
