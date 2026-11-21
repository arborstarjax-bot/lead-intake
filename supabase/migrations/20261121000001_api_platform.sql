-- API platform: workspace-scoped API keys + webhook subscriptions with a
-- delivery log. Backs the /api/v1 REST surface used by CRM integrations
-- (Jobber, ServiceTitan, Housecall Pro, HubSpot, Zapier, etc).
--
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- api_keys — Bearer tokens for /api/v1. Only the SHA-256 hash is stored;
-- the plaintext (lf_live_…) is shown once at creation.
-- ---------------------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  -- sha256 hex of the plaintext key
  key_hash text not null unique,
  -- First chars of the plaintext (e.g. "lf_live_ab12") for display.
  key_prefix text not null,
  scopes text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_workspace_idx on public.api_keys (workspace_id);

-- ---------------------------------------------------------------------------
-- webhook_subscriptions — workspace endpoints that receive signed events.
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url text not null,
  -- HMAC-SHA256 signing secret (plaintext — needed to sign deliveries).
  secret text not null,
  events text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists webhook_subs_workspace_idx
  on public.webhook_subscriptions (workspace_id);

-- ---------------------------------------------------------------------------
-- webhook_deliveries — one row per event×subscription attempt chain.
-- ---------------------------------------------------------------------------
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  -- pending → delivered | failed
  status text not null default 'pending',
  attempts int not null default 0,
  next_retry_at timestamptz,
  last_status_code int,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_pending_idx
  on public.webhook_deliveries (next_retry_at)
  where status = 'pending';
create index if not exists webhook_deliveries_workspace_idx
  on public.webhook_deliveries (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — admins manage keys + subscriptions for their own workspace only.
-- Service role (webhook dispatcher, key verification) bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.api_keys enable row level security;
alter table public.webhook_subscriptions enable row level security;
alter table public.webhook_deliveries enable row level security;

do $$
declare
  is_admin text := 'exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = %s.workspace_id
      and wm.user_id = auth.uid()
      and wm.role = ''admin''
  )';
begin
  execute format('drop policy if exists api_keys_admin_all on public.api_keys');
  execute format(
    'create policy api_keys_admin_all on public.api_keys for all using (%s) with check (%s)',
    format(is_admin, 'api_keys'), format(is_admin, 'api_keys')
  );

  execute format('drop policy if exists webhook_subs_admin_all on public.webhook_subscriptions');
  execute format(
    'create policy webhook_subs_admin_all on public.webhook_subscriptions for all using (%s) with check (%s)',
    format(is_admin, 'webhook_subscriptions'), format(is_admin, 'webhook_subscriptions')
  );

  execute format('drop policy if exists webhook_deliveries_admin_read on public.webhook_deliveries');
  execute format(
    'create policy webhook_deliveries_admin_read on public.webhook_deliveries for select using (%s)',
    format(is_admin, 'webhook_deliveries')
  );
end $$;
