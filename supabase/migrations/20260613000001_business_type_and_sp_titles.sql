-- Add business_type and salesperson_titles to app_settings.
-- business_type drives AI prompt language and template placeholders.
-- salesperson_titles maps salesperson name → job title.
alter table app_settings
  add column if not exists business_type text,
  add column if not exists salesperson_titles jsonb not null default '{}';
