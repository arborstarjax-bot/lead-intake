-- AI Call Campaigns: batch calling leads by status group
CREATE TABLE IF NOT EXISTS ai_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',  -- running, paused, completed, cancelled
  filter TEXT NOT NULL,                     -- 'new' | 'needs_follow_up'
  total_leads INT NOT NULL DEFAULT 0,
  completed_leads INT NOT NULL DEFAULT 0,
  current_lead_id UUID,
  lead_queue JSONB NOT NULL DEFAULT '[]',   -- ordered array of lead IDs to call
  results JSONB NOT NULL DEFAULT '[]',      -- array of { lead_id, name, outcome, summary }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying active campaigns per workspace
CREATE INDEX IF NOT EXISTS idx_ai_campaigns_workspace_status
  ON ai_campaigns (workspace_id, status);

-- RLS
ALTER TABLE ai_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_isolation" ON ai_campaigns
  FOR ALL USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
