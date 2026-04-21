-- Web Push subscriptions (one row per installed PWA that opted in).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text
);

create index if not exists push_subscriptions_created_at_idx
  on public.push_subscriptions (created_at desc);

alter table public.push_subscriptions enable row level security;
