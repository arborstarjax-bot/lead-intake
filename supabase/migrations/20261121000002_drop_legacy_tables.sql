-- Drop the unused tables and columns left behind by the removed
-- AI-calling (Vapi), ArborBridge, and SingleOps features.
-- No application code references any of these as of this migration.

-- AI voice calling tables
drop table if exists public.campaign_leads;
drop table if exists public.ai_call_follow_ups;
drop table if exists public.ai_calls;
drop table if exists public.call_campaigns;
drop table if exists public.voice_agent_config;

-- SingleOps sync audit table
drop table if exists public.sync_audit_log;

-- AI-call columns on leads
alter table public.leads
  drop column if exists ai_call_count,
  drop column if exists ai_last_call_at,
  drop column if exists ai_last_call_status,
  drop column if exists ai_do_not_call,
  drop column if exists ai_notes;

-- ArborBridge columns on leads
alter table public.leads
  drop constraint if exists leads_arborbridge_status_check,
  drop column if exists arborbridge_status,
  drop column if exists arborbridge_record_id,
  drop column if exists arborbridge_last_pushed_at;

-- SingleOps columns on leads + settings
alter table public.leads
  drop constraint if exists leads_singleops_sync_status_check,
  drop column if exists singleops_task_id,
  drop column if exists singleops_sync_status;

alter table public.app_settings
  drop column if exists auto_sync_to_singleops;

-- Note: legacy `ai_called` rows may remain in lead_activities; the UI
-- renders them as neutral "Call logged" entries.
