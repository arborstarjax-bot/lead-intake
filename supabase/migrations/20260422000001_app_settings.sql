-- Single-row app settings. Used by the AI scheduler (PR series: Settings +
-- Google Maps plumbing) to know where the workday starts, how long a job
-- is by default, and which hours / days are workable.
create table if not exists public.app_settings (
  id integer primary key default 1,
  home_address text,
  home_city text,
  home_state text,
  home_zip text,
  work_start_time time not null default '08:00',
  work_end_time time not null default '17:00',
  -- 0 = Sunday, 6 = Saturday; default Mon-Sat.
  work_days smallint[] not null default '{1,2,3,4,5,6}',
  default_job_minutes integer not null default 60,
  travel_buffer_minutes integer not null default 15,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Enforce singleton: only id=1 is ever allowed.
  constraint app_settings_singleton check (id = 1)
);

-- Seed the row so reads never have to handle "no settings yet".
insert into public.app_settings (id) values (1)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Touch updated_at on every change.
create or replace function public.touch_app_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
before update on public.app_settings
for each row
execute function public.touch_app_settings_updated_at();
