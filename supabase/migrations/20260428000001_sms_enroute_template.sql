-- En-route SMS template ("I'm on my way"): one more nullable text
-- column on the per-workspace settings row. Nullable = "fall back to
-- built-in DEFAULT_SMS_ENROUTE". Safe to run multiple times.
alter table public.app_settings
  add column if not exists sms_enroute_template text;
