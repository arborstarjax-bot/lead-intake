-- Add calendar sync status field to leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS calendar_sync_status TEXT DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS calendar_sync_at TIMESTAMPTZ;

-- Add check constraint for valid calendar sync statuses
ALTER TABLE leads
  ADD CONSTRAINT leads_calendar_sync_status_check
  CHECK (calendar_sync_status IN ('not_synced', 'synced', 'sync_failed'));
