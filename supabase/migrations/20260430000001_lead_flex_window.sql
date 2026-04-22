-- Adds an optional "flex window" to a lead so a customer can be grouped
-- onto a day without pinning a specific time. Values:
--   'all_day'  — customer is flexible anywhere during business hours
--   'am'       — customer wants a morning slot, any time
--   'pm'       — customer wants an afternoon slot, any time
-- NULL means a specific scheduled_time is expected (current behavior).
--
-- Flex-windowed leads still use scheduled_day for date. The route
-- optimizer can group all flex leads on a day together and assign
-- concrete times during the optimize pass.

do $$
begin
  create type lead_flex_window as enum ('all_day', 'am', 'pm');
exception when duplicate_object then null;
end $$;

alter table public.leads
  add column if not exists flex_window lead_flex_window;

create index if not exists leads_flex_window_idx
  on public.leads (workspace_id, scheduled_day, flex_window)
  where flex_window is not null;
