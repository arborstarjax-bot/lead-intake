-- Failed join-code lookup attempts, used to rate-limit workspace joins.
-- Joining a workspace requires only the 8-char join code, so guesses are
-- capped per subject (user id, signup email, or caller IP). Written only
-- through the service role, so the limit holds across server instances.

create table if not exists public.join_code_attempts (
  id bigint generated always as identity primary key,
  subject text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists join_code_attempts_subject_idx
  on public.join_code_attempts (subject, attempted_at);

alter table public.join_code_attempts enable row level security;
-- No policies: the table is reachable only via the service role, which
-- bypasses RLS. Authenticated and anonymous callers get nothing.

-- Cheap garbage collection for rows outside every rate-limit window.
create or replace function public.prune_join_code_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.join_code_attempts
  where attempted_at < now() - interval '1 day';
$$;
