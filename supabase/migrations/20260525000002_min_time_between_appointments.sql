-- Add min_time_between_appointments setting (replaces separate job length + buffer).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS min_time_between_appointments integer NOT NULL DEFAULT 60;
