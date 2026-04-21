-- Multi-tenant adoption migration for the EXISTING single-tenant Supabase
-- project (lead-intake / project id zfwftlcrmnkcykljarxg).
--
-- This migration converts the single-tenant schema in-place: every
-- workspace-owned table gets a workspace_id column, existing rows are
-- backfilled into a seed "Default" workspace, and RLS policies are added
-- so future multi-tenant queries never leak across workspaces.
--
-- Adoption flow for the operator (David):
--   1. Run this SQL. A Default workspace is created with no members and
--      with join_code 'DEFAULTS'.
--   2. Sign up via the multi-tenant app using "Join existing workspace"
--      and the DEFAULTS code. You'll be added as a regular user.
--   3. Run the follow-up snippet (supplied separately) to promote yourself
--      to admin and attach created_by.
--
-- Per-user state that depended on the old singleton model (push
-- subscriptions and the singleton Google OAuth token) is dropped — users
-- re-subscribe to push and re-connect their Google Calendar after their
-- first signup. This is intentional: we have no way to safely attribute
-- old rows to specific auth.users that don't exist yet.
--
-- Idempotent: designed to be safely re-run if the SQL editor dies midway.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums — existing app already has lead_status / lead_intake_source /
-- lead_intake_status. Only workspace_role is new.
-- ---------------------------------------------------------------------------

do $$
begin
  create type workspace_role as enum ('admin', 'user');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Workspaces + membership
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 8-char uppercase join code, unambiguous alphabet (no 0/O/1/I).
  join_code text not null unique,
  -- Nullable during bootstrap because the seed Default workspace is
  -- created before any auth.users exists. The post-signup adoption
  -- snippet sets this to the admin's user_id.
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'user',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

-- SECURITY DEFINER so RLS policies on workspace_members don't create a
-- recursive dependency — policies that check "is the caller a member of
-- workspace X" can go through this function safely.
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

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspaces_touch_updated_at on public.workspaces;
create trigger workspaces_touch_updated_at
before update on public.workspaces
for each row execute function public.touch_updated_at();

-- Seed the Default workspace that will own every pre-existing lead +
-- the existing app_settings row. The code 'DEFAULTS' is inside the
-- unambiguous alphabet (D,E,F,A,U,L,T,S) the signup form accepts.
insert into public.workspaces (id, name, join_code)
values (
  '00000000-0000-0000-0000-000000000001',
  'Default',
  'DEFAULTS'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Leads — add workspace_id, backfill, enforce NOT NULL
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;

update public.leads
set workspace_id = '00000000-0000-0000-0000-000000000001'
where workspace_id is null;

alter table public.leads
  alter column workspace_id set not null;

create index if not exists leads_workspace_idx
  on public.leads (workspace_id);
create index if not exists leads_workspace_status_idx
  on public.leads (workspace_id, status);
create index if not exists leads_workspace_created_at_idx
  on public.leads (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- app_settings — reshape singleton (id=1) into per-workspace row keyed on
-- workspace_id. We keep every existing config column (company info,
-- salespeople, templates, default_salesperson, work hours etc.) so the
-- settings page just works after adoption.
-- ---------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;

update public.app_settings
set workspace_id = '00000000-0000-0000-0000-000000000001'
where workspace_id is null;

alter table public.app_settings
  drop constraint if exists app_settings_singleton;

alter table public.app_settings
  drop constraint if exists app_settings_pkey;

alter table public.app_settings
  drop column if exists id;

alter table public.app_settings
  alter column workspace_id set not null;

-- Only add the PK if it isn't already there (makes the migration
-- re-runnable after a partial success).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_pkey' and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings add primary key (workspace_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- push_subscriptions — existing rows predate auth.users and cannot be
-- reattributed. Wipe them (users re-enable notifications on first
-- /leads visit) and add the required columns.
-- ---------------------------------------------------------------------------

delete from public.push_subscriptions;

alter table public.push_subscriptions
  add column if not exists user_id uuid
  references auth.users(id) on delete cascade;

alter table public.push_subscriptions
  add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;

alter table public.push_subscriptions
  alter column user_id set not null;

alter table public.push_subscriptions
  alter column workspace_id set not null;

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_workspace_idx
  on public.push_subscriptions (workspace_id);

-- ---------------------------------------------------------------------------
-- google_oauth_tokens — existing table is keyed on id text (the old
-- singleton "primary" row). Multi-tenant keys on user_id so each member
-- has their own token. Drop + recreate is safe: no auth.users exist yet
-- to attribute old tokens to, and members reconnect Google Calendar
-- after signup.
-- ---------------------------------------------------------------------------

drop table if exists public.google_oauth_tokens;

create table public.google_oauth_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);

drop trigger if exists google_oauth_tokens_touch_updated_at on public.google_oauth_tokens;
create trigger google_oauth_tokens_touch_updated_at
before update on public.google_oauth_tokens
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Storage bucket is already created by the original init migration.
-- (Re-inserting with on conflict do nothing just in case.)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('lead-screenshots', 'lead-screenshots', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Existing tables already have RLS enabled from the single-tenant
-- migrations — they just had no policies (service role bypasses RLS).
-- We add SELECT policies here so user-session reads are scoped to
-- workspace membership / ownership. Writes continue to run through
-- server routes using the service role (plus explicit role checks for
-- admin-only operations).
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.app_settings enable row level security;
alter table public.leads enable row level security;
alter table public.google_oauth_tokens enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.geocode_cache enable row level security;

-- Drop + recreate policies so this migration is re-runnable.

drop policy if exists workspaces_member_read on public.workspaces;
create policy workspaces_member_read on public.workspaces
  for select using (id in (select public.user_workspace_ids(auth.uid())));

drop policy if exists workspace_members_member_read on public.workspace_members;
create policy workspace_members_member_read on public.workspace_members
  for select using (workspace_id in (select public.user_workspace_ids(auth.uid())));

drop policy if exists app_settings_member_read on public.app_settings;
create policy app_settings_member_read on public.app_settings
  for select using (workspace_id in (select public.user_workspace_ids(auth.uid())));

drop policy if exists leads_member_read on public.leads;
create policy leads_member_read on public.leads
  for select using (workspace_id in (select public.user_workspace_ids(auth.uid())));

drop policy if exists google_oauth_tokens_owner_read on public.google_oauth_tokens;
create policy google_oauth_tokens_owner_read on public.google_oauth_tokens
  for select using (user_id = auth.uid());

drop policy if exists push_subscriptions_owner_read on public.push_subscriptions;
create policy push_subscriptions_owner_read on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists geocode_cache_read_all on public.geocode_cache;
create policy geocode_cache_read_all on public.geocode_cache
  for select using (true);
