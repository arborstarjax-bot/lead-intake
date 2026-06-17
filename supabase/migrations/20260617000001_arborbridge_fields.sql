-- Add ArborBridge integration fields to leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS arborbridge_status TEXT DEFAULT 'not_pushed',
  ADD COLUMN IF NOT EXISTS arborbridge_record_id TEXT,
  ADD COLUMN IF NOT EXISTS arborbridge_last_pushed_at TIMESTAMPTZ;

-- Add check constraint for valid arborbridge statuses
ALTER TABLE leads
  ADD CONSTRAINT leads_arborbridge_status_check
  CHECK (arborbridge_status IN ('not_pushed', 'pushed_to_arborbridge', 'push_failed'));
