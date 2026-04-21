-- Adds a singleton "default salesperson" to app_settings. The UI picks
-- from the existing salespeople roster; at render time any lead whose
-- sales_person is null falls back to this value so {salesPerson} in SMS
-- / email templates and the chip display still read correctly. Idempotent
-- (uses `add column if not exists`) so re-running is safe.
alter table public.app_settings
  add column if not exists default_salesperson text;
