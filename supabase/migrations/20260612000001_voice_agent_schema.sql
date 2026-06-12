-- Voice Agent schema: config, call log, follow-up queue, campaigns.
-- All tables use workspace_id for multi-tenancy and enable RLS.

-- ---------------------------------------------------------------------------
-- voice_agent_config — one row per workspace, controls AI voice agent behavior
-- ---------------------------------------------------------------------------

create table if not exists public.voice_agent_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Master toggle
  enabled boolean not null default false,

  -- Persona
  agent_name text not null default 'AI Assistant',
  company_name text,
  greeting_template text,
  system_prompt text,

  -- Voice (Vapi + ElevenLabs)
  vapi_assistant_id text,
  vapi_phone_id text,
  voice_provider text not null default 'elevenlabs',
  voice_id text,
  voice_cloned boolean not null default false,

  -- Calling rules
  call_window_start time not null default '09:00',
  call_window_end time not null default '17:00',
  call_days smallint[] not null default '{1,2,3,4,5}',  -- 1=Mon..5=Fri
  timezone text not null default 'America/New_York',
  max_attempts integer not null default 3,
  retry_delay_mins integer not null default 60,
  concurrent_calls integer not null default 2,

  -- Auto-call triggers
  auto_call_new_leads boolean not null default true,
  auto_follow_up_no_answer boolean not null default true,
  auto_follow_up_estimates boolean not null default false,
  auto_reengage_dormant boolean not null default false,
  dormant_days_threshold integer not null default 14,

  -- Human transfer
  transfer_phone_number text,
  transfer_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint voice_agent_config_workspace_unique unique (workspace_id)
);

alter table public.voice_agent_config enable row level security;

drop trigger if exists voice_agent_config_touch_updated_at on public.voice_agent_config;
create trigger voice_agent_config_touch_updated_at
before update on public.voice_agent_config
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ai_calls — log of every AI-placed or AI-received call
-- ---------------------------------------------------------------------------

create table if not exists public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid,  -- FK added after call_campaigns table is created

  -- Vapi reference
  vapi_call_id text unique,

  -- Call metadata
  direction text not null default 'outbound',
  from_number text,
  to_number text not null,
  status text not null default 'queued',
  -- status: queued | ringing | in_progress | completed | failed
  --         | no_answer | voicemail | transferred | cancelled

  -- Timing
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  duration_secs integer,

  -- Attempt tracking
  attempt_number integer not null default 1,

  -- AI outcomes
  call_summary text,
  call_sentiment text,
  lead_qualified boolean,
  service_needed text,
  info_gathered jsonb,
  appointment_booked boolean default false,

  -- Recordings & transcripts
  recording_url text,
  transcript jsonb,

  -- Errors
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_calls enable row level security;

create index if not exists ai_calls_workspace_idx on public.ai_calls (workspace_id);
create index if not exists ai_calls_lead_idx on public.ai_calls (lead_id);
create index if not exists ai_calls_status_idx on public.ai_calls (status);
create index if not exists ai_calls_vapi_call_id_idx on public.ai_calls (vapi_call_id);

drop trigger if exists ai_calls_touch_updated_at on public.ai_calls;
create trigger ai_calls_touch_updated_at
before update on public.ai_calls
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ai_call_follow_ups — scheduled follow-up queue
-- ---------------------------------------------------------------------------

create table if not exists public.ai_call_follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,

  reason text not null,
  -- no_answer | voicemail | callback_requested | estimate_follow_up
  -- | proposal_follow_up | dormant_reengagement | custom

  scheduled_at timestamptz not null,
  priority integer not null default 5,

  status text not null default 'pending',
  -- pending | in_progress | completed | skipped | expired

  executed_at timestamptz,
  result_call_id uuid references public.ai_calls(id),
  context_notes text,

  created_at timestamptz not null default now()
);

alter table public.ai_call_follow_ups enable row level security;

create index if not exists ai_call_follow_ups_pending_idx
  on public.ai_call_follow_ups (scheduled_at)
  where status = 'pending';
create index if not exists ai_call_follow_ups_workspace_idx
  on public.ai_call_follow_ups (workspace_id);

-- ---------------------------------------------------------------------------
-- call_campaigns — batch outbound call campaign management
-- ---------------------------------------------------------------------------

create table if not exists public.call_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  name text not null,
  description text,

  target_filter jsonb not null default '{}',
  sort_by text not null default 'proximity',
  home_location jsonb,  -- {lat, lng}

  status text not null default 'draft',
  -- draft | scheduled | running | paused | completed | cancelled

  scheduled_start timestamptz,
  scheduled_end timestamptz,

  greeting_override text,
  system_prompt_override text,

  -- Denormalized stats
  total_leads integer not null default 0,
  calls_made integer not null default 0,
  calls_answered integer not null default 0,
  appointments_booked integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.call_campaigns enable row level security;

drop trigger if exists call_campaigns_touch_updated_at on public.call_campaigns;
create trigger call_campaigns_touch_updated_at
before update on public.call_campaigns
for each row execute function public.touch_updated_at();

-- Now add the FK from ai_calls to call_campaigns
alter table public.ai_calls
  add constraint ai_calls_campaign_fk
  foreign key (campaign_id) references public.call_campaigns(id)
  on delete set null;

create index if not exists ai_calls_campaign_idx on public.ai_calls (campaign_id);

-- ---------------------------------------------------------------------------
-- campaign_leads — per-lead state within a campaign
-- ---------------------------------------------------------------------------

create table if not exists public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.call_campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,

  call_order integer not null,
  distance_miles numeric(8,2),

  status text not null default 'pending',
  -- pending | calling | completed | skipped | failed

  call_id uuid references public.ai_calls(id),
  outcome text,

  created_at timestamptz not null default now(),

  constraint campaign_leads_unique unique (campaign_id, lead_id)
);

alter table public.campaign_leads enable row level security;

create index if not exists campaign_leads_order_idx
  on public.campaign_leads (campaign_id, call_order);

-- ---------------------------------------------------------------------------
-- leads table additions — AI call tracking columns
-- ---------------------------------------------------------------------------

alter table public.leads add column if not exists ai_call_count integer default 0;
alter table public.leads add column if not exists ai_last_call_at timestamptz;
alter table public.leads add column if not exists ai_last_call_status text;
alter table public.leads add column if not exists ai_do_not_call boolean default false;
alter table public.leads add column if not exists ai_notes text;
