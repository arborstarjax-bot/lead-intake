-- Add setup_completed flag so we can redirect new workspaces to the
-- setup wizard until they fill in the essentials (home address, company
-- info, etc.). Existing workspaces that pre-date this migration have
-- presumably already configured their settings, so we default them to
-- true. New rows inserted via signup will get false.
alter table public.app_settings
  add column if not exists setup_completed boolean not null default false;

-- Backfill existing workspaces: if a home_address is already set, the
-- workspace was clearly configured, so mark it complete. For the rest,
-- mark true anyway since we don't want to force existing users through
-- the wizard retroactively.
update public.app_settings set setup_completed = true;
