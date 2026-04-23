-- ---------------------------------------------------------------------------
-- push_subscriptions: native-platform support (Capacitor iOS / Android).
--
-- Web Push is endpoint-based (browser-provided URL) and VAPID-signed. Native
-- push is device-token-based (APNs / FCM) with no endpoint. Both flavors
-- now share this table, keyed off the new `platform` column:
--
--   platform = 'web'   → endpoint + p256dh + auth required; device_token null
--   platform = 'ios'   → device_token required; endpoint/p256dh/auth null
--   platform = 'android' → device_token required; endpoint/p256dh/auth null
--
-- The existing web flow (src/app/api/push/subscribe/route.ts + src/lib/push.ts)
-- is unchanged — it only ever writes platform='web' rows, and the `web-push`
-- fan-out path in sendNewLeadPush filters to platform='web' after this
-- migration so it doesn't try to POST to native rows that lack an endpoint.
-- ---------------------------------------------------------------------------

alter table public.push_subscriptions
  add column if not exists platform text not null default 'web'
    check (platform in ('web', 'ios', 'android'));

alter table public.push_subscriptions
  add column if not exists device_token text;

alter table public.push_subscriptions
  add column if not exists app_version text;

-- The original schema declared endpoint/p256dh/auth as NOT NULL because it
-- only supported web push. Native rows won't have them, so relax the
-- nullability and move the "required on web" invariant into a CHECK.
alter table public.push_subscriptions
  alter column endpoint drop not null;

alter table public.push_subscriptions
  alter column p256dh drop not null;

alter table public.push_subscriptions
  alter column auth drop not null;

-- Per-platform column requirements: catches a bad payload at the DB layer
-- even if a future route handler forgets to validate. The constraint is
-- named so it can be dropped/recreated deterministically.
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_fields_chk;

alter table public.push_subscriptions
  add constraint push_subscriptions_platform_fields_chk
  check (
    (platform = 'web'
      and endpoint is not null
      and p256dh is not null
      and auth is not null
      and device_token is null)
    or (platform in ('ios', 'android')
      and device_token is not null
      and endpoint is null
      and p256dh is null
      and auth is null)
  );

-- The original UNIQUE on endpoint is web-only; drop it (Postgres auto-named
-- it push_subscriptions_endpoint_key) and replace with a partial unique
-- that only fires for non-null endpoints. Keeps the ON CONFLICT (endpoint)
-- upsert on the web route working, without blocking multiple native rows
-- (which all have endpoint IS NULL).
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_key;

create unique index if not exists push_subscriptions_endpoint_uq
  on public.push_subscriptions (endpoint)
  where endpoint is not null;

-- One native row per (workspace_id, device_token) so re-registering the
-- same device token in the same workspace upserts instead of duplicating.
create unique index if not exists push_subscriptions_device_token_uq
  on public.push_subscriptions (workspace_id, device_token)
  where device_token is not null;

-- Speed up the per-user / per-platform reads the send fan-out will do.
create index if not exists push_subscriptions_platform_idx
  on public.push_subscriptions (workspace_id, platform);
