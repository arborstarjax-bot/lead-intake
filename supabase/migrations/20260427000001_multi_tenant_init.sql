-- Multi-tenant schema for the lead-intake SaaS fork.
--
-- This file is a FRESH schema meant to be applied to a brand-new Supabase
-- project — not an in-place migration of the single-tenant app. Everything
-- a workspace owns is partitioned by workspace_id; per-user resources
-- (Google OAuth, push subscriptions) are keyed to auth.users so individual
-- members connect their own calendar and receive their own badges.
--
-- RLS is enforced on every table. The service-role key bypasses RLS for
-- server-side admin operations (e.g. refreshing OAuth tokens); user-session
-- clients see only rows for workspaces they're a member of. Role-gated
-- mutations (settings edits, invites, kick/promote) are additionally
-- checked in server routes against workspace_members.role = 'admin'.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums (identical to single-tenant app so existing client code keeps working)
-- ---------------------------------------------------------------------------

create type lead_status as enum (
  'New',
  'Called / No Response',
  'Scheduled',
  'Completed',
  'Lost'
);

create type lead_intake_source as enum (
  'web_upload',
  'quick_link',
  'email_ingest',
  'manual'
);

create type lead_intake_status as enum (
  'processing',
  'needs_review',
  'ready',
  'failed'
);

create type workspace_role as enum ('admin', 'user');

-- ---------------------------------------------------------------------------
-- Workspaces + membership
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 8-char uppercase alphanumeric join code. Uppercase-only and without
  -- ambiguous characters (0/O, 1/I) so people can read it off a screen.
  join_code text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'user',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx
  on public.workspace_members (user_id);

-- Convenience helper: which workspaces is the calling user a member of?
-- SECURITY DEFINER so RLS policies on workspace_members don't create a
-- recursive dependency (policies on workspace_members need to check
-- membership too — but via `user_id = auth.uid()` directly instead).
create or replace function public.user_workspace_ids(uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id
  from public.workspace_members
  where user_id = uid;
$$;

-- ---------------------------------------------------------------------------
-- App settings — one row per workspace
-- ---------------------------------------------------------------------------

create table public.app_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
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
  company_name text,
  company_phone text,
  company_email text,
  salespeople text[] not null default '{}',
  default_salesperson text,
  sms_intro_template text,
  sms_confirm_template text,
  email_subject_template text,
  email_body_template text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_settings_touch_updated_at
before update on public.app_settings
for each row execute function public.touch_updated_at();

create trigger workspaces_touch_updated_at
before update on public.workspaces
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  date date,
  first_name text,
  last_name text,
  client text,
  phone_number text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  status lead_status not null default 'New',
  sales_person text,
  scheduled_day date,
  scheduled_time time,
  notes text,
  screenshot_url text,
  screenshot_path text,
  extraction_confidence jsonb,
  calendar_event_id text,
  calendar_scheduled_day date,
  calendar_scheduled_time time,
  status_changed_at timestamptz not null default now(),
  intake_source lead_intake_source not null default 'manual',
  intake_status lead_intake_status not null default 'ready'
);

create index leads_workspace_idx on public.leads (workspace_id);
create index leads_workspace_status_idx on public.leads (workspace_id, status);
create index leads_workspace_created_at_idx
  on public.leads (workspace_id, created_at desc);

create trigger leads_touch_updated_at
before update on public.leads
for each row execute function public.touch_updated_at();

-- Flip status_changed_at only when status actually changes.
create or replace function public.touch_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if (new.status is distinct from old.status) then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger leads_status_changed_at
before update on public.leads
for each row execute function public.touch_status_changed_at();

-- ---------------------------------------------------------------------------
-- Per-user: Google OAuth tokens, push subscriptions
-- ---------------------------------------------------------------------------

-- Each user connects their own Google Calendar. We key on user_id so
-- members in the same workspace don't overwrite each other's tokens.
create table public.google_oauth_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);

create trigger google_oauth_tokens_touch_updated_at
before update on public.google_oauth_tokens
for each row execute function public.touch_updated_at();

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  last_acknowledged_at timestamptz not null default now()
);

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);
create index push_subscriptions_workspace_idx
  on public.push_subscriptions (workspace_id);

-- ---------------------------------------------------------------------------
-- Shared: geocode cache (address is global, no privacy concern)
-- ---------------------------------------------------------------------------

create table public.geocode_cache (
  address text primary key,
  lat double precision not null,
  lng double precision not null,
  cached_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Storage bucket for screenshots
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('lead-screenshots', 'lead-screenshots', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Philosophy: all app tables are workspace-scoped; members can read + write
-- rows in their workspaces; role-gating (admin-only settings writes, etc.)
-- is enforced in server code, not policies. Policies only prevent
-- cross-workspace leakage.
--
-- The service-role key bypasses RLS entirely — used for server-side
-- operations that should not run as a specific user (e.g. refreshing a
-- user's Google token, inserting a lead during quick-link ingest).
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.app_settings enable row level security;
alter table public.leads enable row level security;
alter table public.google_oauth_tokens enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.geocode_cache enable row level security;

-- Workspaces: members can read their own workspaces. Inserts/updates go
-- through server code using the service role.
create policy workspaces_member_read on public.workspaces
  for select using (id in (select public.user_workspace_ids(auth.uid())));

-- Workspace members: you can see every member of any workspace you're in.
create policy workspace_members_member_read on public.workspace_members
  for select using (workspace_id in (select public.user_workspace_ids(auth.uid())));

-- App settings: members can read; writes go through server code with
-- additional admin-role gating.
create policy app_settings_member_read on public.app_settings
  for select using (workspace_id in (select public.user_workspace_ids(auth.uid())));

-- Leads: members can select; mutations run through server code that uses
-- the service role (so inserts from unauthenticated ingest paths — none in
-- the multi-tenant app — and cron jobs can still work).
create policy leads_member_read on public.leads
  for select using (workspace_id in (select public.user_workspace_ids(auth.uid())));

-- Google OAuth tokens and push subscriptions: each user sees only their
-- own rows.
create policy google_oauth_tokens_owner_read on public.google_oauth_tokens
  for select using (user_id = auth.uid());

create policy push_subscriptions_owner_read on public.push_subscriptions
  for select using (user_id = auth.uid());

-- Geocode cache: public read OK (it's just address→lat/lng from Google).
create policy geocode_cache_read_all on public.geocode_cache
  for select using (true);
