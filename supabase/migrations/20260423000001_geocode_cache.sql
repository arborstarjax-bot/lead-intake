-- Cache of geocoded addresses (free-form address string -> lat/lng).
-- Used by the Route Map page so we don't re-hit the Geocoding API every
-- time the user flips days; addresses rarely move, so an open-ended cache
-- is safe. A background clean-up is unnecessary at David's volume.
create table if not exists public.geocode_cache (
  address text primary key,
  lat double precision not null,
  lng double precision not null,
  cached_at timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;
