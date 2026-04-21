-- Expand the singleton app_settings row with company info, salespeople,
-- and customizable SMS / email templates so the boss can tailor the app
-- without code changes. Adds are idempotent + nullable where the UI treats
-- null as "use built-in default", so previously-deployed environments keep
-- working even before this migration is applied.
alter table public.app_settings
  add column if not exists company_name text,
  add column if not exists company_phone text,
  add column if not exists company_email text,
  add column if not exists salespeople text[] not null default '{}',
  add column if not exists sms_intro_template text,
  add column if not exists sms_confirm_template text,
  add column if not exists email_subject_template text,
  add column if not exists email_body_template text;
