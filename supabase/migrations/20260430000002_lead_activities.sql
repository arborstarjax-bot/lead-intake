-- Lead activity log. Captures lifecycle events (intake → scheduled → completed)
-- plus lightweight contact actions (call / text clicks). Purely additive — the
-- app still reads status from `leads.status`; this table is a chronological
-- audit so the UI can render a per-lead timeline without reverse-engineering
-- what happened from a row's current state.

do $$
begin
  create type lead_activity_type as enum (
    'lead_intake',
    'lead_scheduled',
    'lead_completed',
    'customer_called',
    'customer_texted'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  type lead_activity_type not null,
  -- Freeform structured details, e.g. {"outcome": "missed"} for a call or
  -- {"from": "New", "to": "Scheduled"} for a status transition. Kept as jsonb
  -- so we can evolve the UI without chasing column migrations.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_activities_lead_idx
  on public.lead_activities (lead_id, created_at desc);

create index if not exists lead_activities_workspace_idx
  on public.lead_activities (workspace_id, created_at desc);

-- Backfill: for every existing lead, seed a synthetic lead_intake activity at
-- the lead's own created_at so the timeline isn't empty for historical rows.
-- Skip leads that already have one to make the migration re-runnable.
insert into public.lead_activities (workspace_id, lead_id, type, created_at, details)
select l.workspace_id, l.id, 'lead_intake', l.created_at,
       jsonb_build_object('backfilled', true)
from public.leads l
where not exists (
  select 1 from public.lead_activities a
  where a.lead_id = l.id and a.type = 'lead_intake'
);
