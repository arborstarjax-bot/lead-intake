-- Add auto_sync_to_singleops toggle to workspace settings
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS auto_sync_to_singleops BOOLEAN NOT NULL DEFAULT false;

-- Add singleops_task_id to leads for bidirectional sync mapping
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS singleops_task_id TEXT;

-- Add singleops_sync_status for tracking reverse-sync state
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS singleops_sync_status TEXT DEFAULT 'idle';

ALTER TABLE leads
  ADD CONSTRAINT leads_singleops_sync_status_check
  CHECK (singleops_sync_status IN ('idle', 'pending', 'synced', 'failed'));
