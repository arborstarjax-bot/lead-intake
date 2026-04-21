-- Per-subscription "last seen" marker so each device's badge count can
-- represent only the leads that arrived since THAT device last opened /leads.
alter table public.push_subscriptions
  add column if not exists last_acknowledged_at timestamptz not null default now();
