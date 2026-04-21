-- Add the 'Lost' value to the lead_status enum and introduce the
-- status_changed_at column used by the 30-day auto-sweep.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` must run outside any transaction that
-- later references the new value. Supabase's SQL editor runs each
-- statement in its own transaction, so ordering the ALTER TYPE first in
-- its own statement is sufficient.

alter type lead_status add value if not exists 'Lost';

-- Track when a lead's status last changed so edits to other fields don't
-- reset the 30-day clock used to move "Called / No Response" → "Lost".
alter table public.leads
  add column if not exists status_changed_at timestamptz not null default now();

-- Backfill existing rows so the sweep doesn't immediately mark every
-- "Called / No Response" lead as Lost on first run.
update public.leads
set status_changed_at = updated_at
where status_changed_at = created_at;

create or replace function public.touch_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if (new.status is distinct from old.status) then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists leads_status_changed_at on public.leads;
create trigger leads_status_changed_at
before update on public.leads
for each row
execute function public.touch_status_changed_at();
