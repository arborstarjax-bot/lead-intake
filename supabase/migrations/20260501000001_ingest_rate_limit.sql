-- Atomic per-workspace ingest rate limit.
--
-- Before this, the Starter tier's 50/day cap was enforced by
-- (1) an in-memory sliding window (per-process) and
-- (2) a SELECT count(*) FROM leads check inside the ingest route.
-- Both are non-atomic across Vercel instances: two concurrent requests
-- could both see `used=48`, both pass the check, and both insert, leaving
-- the workspace at 52/50 — 2× the intended OpenAI spend.
--
-- This migration adds a true atomic counter keyed on
-- (workspace_id, bucket_date) and two SECURITY DEFINER RPCs:
--
--   reserve_ingest_quota(ws, n, max_per_day):
--     Atomically increments the counter IFF the new total stays under
--     the cap. Returns {ok, used, remaining}. Cross-transaction races
--     are blocked by the row-level lock the UPDATE takes on the
--     counter row.
--
--   refund_ingest_quota(ws, n):
--     Decrements the counter (floored at 0). Called when an ingest
--     batch errors out so the user isn't silently charged for a
--     request they didn't actually use.

create table if not exists public.rate_limit_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bucket_date date not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, bucket_date)
);

create index if not exists rate_limit_counters_updated_idx
  on public.rate_limit_counters (updated_at);

create or replace function public.reserve_ingest_quota(
  ws uuid,
  n integer,
  max_per_day integer
)
returns table(ok boolean, used integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Bucket by America/New_York day so "50/day" resets at local
  -- midnight instead of UTC midnight. Matches how users think about
  -- a daily cap.
  bd date := (now() at time zone 'America/New_York')::date;
  new_count integer;
  cur integer;
begin
  -- Ensure a row exists for today. Cheap — one round-trip even when
  -- the row was created by a prior request in the same day.
  insert into public.rate_limit_counters (workspace_id, bucket_date, count)
  values (ws, bd, 0)
  on conflict (workspace_id, bucket_date) do nothing;

  -- Atomic check + increment. If `count + n` would exceed the cap,
  -- the WHERE guard prevents the update and RETURNING yields nothing.
  update public.rate_limit_counters
  set count = count + n,
      updated_at = now()
  where workspace_id = ws
    and bucket_date = bd
    and count + n <= max_per_day
  returning count into new_count;

  if new_count is not null then
    return query select true, new_count, greatest(0, max_per_day - new_count);
  else
    -- Reservation rejected — report the existing count so callers can
    -- tell the user how many they have left.
    select count into cur
    from public.rate_limit_counters
    where workspace_id = ws and bucket_date = bd;
    return query
      select false, coalesce(cur, 0), greatest(0, max_per_day - coalesce(cur, 0));
  end if;
end;
$$;

create or replace function public.refund_ingest_quota(
  ws uuid,
  n integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bd date := (now() at time zone 'America/New_York')::date;
begin
  update public.rate_limit_counters
  set count = greatest(0, count - n),
      updated_at = now()
  where workspace_id = ws and bucket_date = bd;
end;
$$;

grant execute on function public.reserve_ingest_quota(uuid, integer, integer) to service_role;
grant execute on function public.refund_ingest_quota(uuid, integer) to service_role;
