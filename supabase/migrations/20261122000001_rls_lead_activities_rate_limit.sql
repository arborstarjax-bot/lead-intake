-- Close anon-key access to tables/functions that were created without
-- row level security:
--
--   lead_activities (20260430000002): no RLS, so the public anon key could
--     read/insert/update/delete every workspace's activity log.
--   rate_limit_counters (20260501000001): no RLS, and its SECURITY DEFINER
--     reserve_ingest_quota / refund_ingest_quota functions kept Postgres's
--     default EXECUTE grant to PUBLIC, so anyone could reset or burn a
--     workspace's daily ingest cap.
--
-- Both tables are written only by server routes using the service role,
-- which bypasses RLS, so no write policies are needed.

alter table public.lead_activities enable row level security;

-- Authenticated members can read their own workspace's activity log
-- (the timeline UI queries it through the anon-key browser client).
drop policy if exists lead_activities_select on public.lead_activities;
create policy lead_activities_select on public.lead_activities
  for select using (workspace_id in (select public.user_workspace_ids(auth.uid())));

alter table public.rate_limit_counters enable row level security;

-- No policies at all: nothing should read or write this table as
-- anon/authenticated. The service role bypasses RLS for the ingest routes.

-- Remove the implicit PUBLIC EXECUTE grant and re-grant only to
-- service_role. Revoking from public also covers anon and authenticated,
-- since their EXECUTE privilege comes through PUBLIC.
revoke execute on function public.reserve_ingest_quota(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.refund_ingest_quota(uuid, integer) from public, anon, authenticated;

grant execute on function public.reserve_ingest_quota(uuid, integer, integer) to service_role;
grant execute on function public.refund_ingest_quota(uuid, integer) to service_role;
