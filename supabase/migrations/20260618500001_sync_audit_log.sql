-- Sync audit log: records every sync operation for debugging and visibility
CREATE TABLE IF NOT EXISTS sync_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- What was synced
  entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'task')),
  entity_id UUID,
  entity_name TEXT,

  -- Sync details
  action TEXT NOT NULL CHECK (action IN (
    'created', 'updated', 'completed', 'rescheduled', 'cancelled',
    'synced_to_singleops', 'synced_from_singleops', 'sync_failed'
  )),
  direction TEXT NOT NULL CHECK (direction IN ('leadflow_to_singleops', 'singleops_to_leadflow', 'internal')),
  details JSONB DEFAULT '{}',

  -- Status
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
  error_message TEXT,

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_audit_workspace ON sync_audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_audit_entity ON sync_audit_log(entity_type, entity_id);

-- RLS
ALTER TABLE sync_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_audit_workspace_read" ON sync_audit_log
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "sync_audit_workspace_insert" ON sync_audit_log
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
