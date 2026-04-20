-- Initial schema for lead-intake.
-- One table for leads, one for Google OAuth tokens, and one private storage
-- bucket for screenshots. Authenticated users (i.e. anyone who can sign
-- into the admin app) have full access; anonymous users have no direct
-- access — the quick-upload endpoint uses the service role via the server.

create extension if not exists pgcrypto;

create type lead_status as enum (
  'New',
  'Called / No Response',
  'Scheduled',
  'Completed'
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

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
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
  intake_source lead_intake_source not null default 'manual',
  intake_status lead_intake_status not null default 'ready'
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_phone_idx on public.leads (phone_number);
create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_created_at_idx on public.leads (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

-- Single-tenant admin app: anyone with a valid Supabase session gets full
-- access. Quick-upload (public) uses the service role key from the server,
-- which bypasses RLS by design.
create policy "leads authed full access"
  on public.leads for all
  to authenticated
  using (true)
  with check (true);

create table if not exists public.google_oauth_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);

alter table public.google_oauth_tokens enable row level security;

create policy "own tokens"
  on public.google_oauth_tokens for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Private storage bucket for screenshots. We never expose it via RLS —
-- the server re-signs URLs on demand.
insert into storage.buckets (id, name, public)
values ('lead-screenshots', 'lead-screenshots', false)
on conflict (id) do nothing;

create policy "screenshots authed read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'lead-screenshots');
