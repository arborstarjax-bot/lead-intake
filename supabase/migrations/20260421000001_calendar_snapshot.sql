-- Snapshot the Scheduled Day/Time that each lead was last synced to Google
-- Calendar with. When either value drifts from the canonical `scheduled_day`
-- or `scheduled_time` we know the Calendar event needs to be PATCHed.
alter table public.leads
  add column if not exists calendar_scheduled_day date,
  add column if not exists calendar_scheduled_time time;
