-- Billing schema: plans, trial tracking, Stripe IDs, billing event audit log.
-- No Stripe API calls yet — this is pure schema groundwork that subsequent
-- PRs (webhook, checkout, portal) build on.

-- Plans a workspace can be on.
--   trial   = 14-day free eval of Starter quotas
--   starter = $29.99/mo + $9.99/additional seat, 30 uploads/day
--   pro     = $59.99/mo + $9.99/additional seat, unlimited uploads
--   free    = lapsed/canceled workspace. Read-only. 30-day grace, then data deleted.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'workspace_plan') then
    create type public.workspace_plan as enum ('trial', 'starter', 'pro', 'free');
  end if;
end $$;

-- Mirrors Stripe's subscription.status, simplified. Drives the middleware
-- feature gate.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum (
      'trialing', 'active', 'past_due', 'canceled', 'incomplete'
    );
  end if;
end $$;

-- Add billing columns to workspaces. Additive only — safe to run on live DB.
alter table public.workspaces
  add column if not exists plan public.workspace_plan not null default 'trial',
  add column if not exists trial_ends_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status public.subscription_status,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  -- When a plan transitions to 'free' (lapsed/canceled), this records
  -- when the 30-day grace-before-delete clock starts. Null while in any
  -- paid state. Scheduled job (future) reads this to hard-delete.
  add column if not exists data_retention_deadline timestamptz;

create unique index if not exists workspaces_stripe_customer_id_key
  on public.workspaces (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists workspaces_stripe_subscription_id_key
  on public.workspaces (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Grandfather existing workspaces (created before this migration ran) onto
-- the Pro plan with no trial clock. They've already proven value during the
-- beta — forcing them into a 14-day trial that immediately expires would be
-- hostile. New workspaces created after this migration start on `trial`.
update public.workspaces
set plan = 'pro',
    subscription_status = 'active'
where plan = 'trial' -- default, means it was never set explicitly
  and created_at < now()
  and trial_ends_at is null;

-- Trigger: new workspace inserts get a 14-day trial clock. Belt-and-suspenders
-- so the app code can't forget.
create or replace function public.set_workspace_trial_default()
returns trigger language plpgsql as $$
begin
  if new.trial_ends_at is null and new.plan = 'trial' then
    new.trial_ends_at := now() + interval '14 days';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_set_trial_default on public.workspaces;
create trigger workspaces_set_trial_default
  before insert on public.workspaces
  for each row execute function public.set_workspace_trial_default();

-- Audit trail for every Stripe webhook we process. Primary use is
-- idempotency — Stripe retries deliveries, so we insert on unique
-- stripe_event_id and skip on conflict.
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  stripe_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists billing_events_workspace_id_idx
  on public.billing_events(workspace_id);

create index if not exists billing_events_created_at_idx
  on public.billing_events(created_at desc);

-- RLS: only workspace admins can see their own billing_events. Service role
-- (used by the webhook) bypasses RLS.
alter table public.billing_events enable row level security;

drop policy if exists billing_events_select_admin on public.billing_events;
create policy billing_events_select_admin on public.billing_events
  for select using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = billing_events.workspace_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
  );
