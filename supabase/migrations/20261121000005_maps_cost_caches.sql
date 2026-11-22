-- Maps cost reduction, ported from ArborCore's maps-cost-caches work.
--
-- Distance Matrix is billed per origin×destination element, and the same
-- legs were priced again on every route load, every slot rank and every
-- optimize pass — the per-request memo only spared duplicates inside one
-- API call. Two addresses keep their drive time for weeks, so the answer
-- is worth keeping between requests in `drive_time_cache`.
--
-- `geocode_cache` gains `failed_at` so an unresolvable address is
-- negative-cached (ZERO_RESULTS) for a TTL instead of being billed to
-- Google on every repeat lookup. lat/lng go nullable for miss rows.
--
-- Both caches are shared across workspaces on purpose: the drive between
-- two addresses does not depend on who asked. Reads tolerate a missing
-- table/rows, so applying this migration is what turns the saving on.

create table if not exists public.drive_time_cache (
  -- "origin=>destination|bucket" where bucket is "static" or a
  -- weekday/hour bucket ("t<dow>-<hour>") for traffic-aware lookups.
  cache_key text primary key,
  drive_seconds integer not null,
  distance_meters integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drive_time_cache_updated_at_idx
  on public.drive_time_cache (updated_at desc);

alter table public.drive_time_cache enable row level security;
-- service-role only; like geocode_cache it holds no tenant data.
drop policy if exists drive_time_cache_read_all on public.drive_time_cache;
create policy drive_time_cache_read_all on public.drive_time_cache
  for select using (true);

alter table public.geocode_cache
  add column if not exists failed_at timestamptz;
alter table public.geocode_cache alter column lat drop not null;
alter table public.geocode_cache alter column lng drop not null;
