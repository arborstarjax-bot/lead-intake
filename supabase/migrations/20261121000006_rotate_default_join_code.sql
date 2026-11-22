-- Rotate the seeded Default workspace join code off the publicly known
-- value 'DEFAULTS' from 20260427000001_multi_tenant_adopt.sql. Anyone who
-- read the repo could join that workspace as a member; the new code is
-- generated from pgcrypto's gen_random_bytes in the same unambiguous
-- alphabet the app uses.
--
-- ACTION FOR THE OPERATOR: after running this, review the member list of
-- the Default workspace — anyone who joined via 'DEFAULTS' before this
-- rotation should be verified or removed. The notice below prints the
-- workspace's member count and emails for that review.

do $$
declare
  ws_id uuid := '00000000-0000-0000-0000-000000000001';
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  new_code text;
  member_count int;
  member_emails text;
begin
  select string_agg(
           substr(alphabet, (get_byte(gen_random_bytes(8), i) % 32) + 1, 1),
           ''
         )
  into new_code
  from generate_series(0, 7) as i;

  update public.workspaces
  set join_code = new_code
  where id = ws_id and join_code = 'DEFAULTS';

  if found then
    raise notice 'Rotated Default workspace join code off DEFAULTS.';
  else
    raise notice 'Default workspace join code was already rotated; no change.';
  end if;

  select count(*),
         coalesce(string_agg(coalesce(u.email, m.user_id::text), ', '), '')
  into member_count, member_emails
  from public.workspace_members m
  left join auth.users u on u.id = m.user_id
  where m.workspace_id = ws_id;

  raise notice 'Default workspace has % member(s) — REVIEW for unexpected joins via DEFAULTS: %',
    member_count, member_emails;
end $$;
