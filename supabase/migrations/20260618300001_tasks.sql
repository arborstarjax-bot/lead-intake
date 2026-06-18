-- Tasks module: general-purpose scheduling (meetings, callbacks, site visits, etc.)
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Core fields
  name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Scheduled'
    CHECK (status IN ('Scheduled', 'Completed', 'Rescheduled', 'Cancelled')),
  
  -- Schedule
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  
  -- Location
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  
  -- Assignment
  assignee TEXT,
  created_by UUID REFERENCES auth.users(id),
  
  -- File uploads (reuses same Supabase storage as lead screenshots)
  file_url TEXT,
  file_path TEXT,
  
  -- AI extraction
  extraction_source TEXT CHECK (extraction_source IN ('manual', 'upload_extract')),
  extraction_confidence JSONB,
  screenshot_url TEXT,
  screenshot_path TEXT,
  
  -- SingleOps sync
  singleops_task_id TEXT,
  singleops_sync_status TEXT DEFAULT 'idle'
    CHECK (singleops_sync_status IN ('idle', 'pending', 'synced', 'failed')),
  singleops_sync_error TEXT,
  singleops_last_synced_at TIMESTAMPTZ,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for workspace queries
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_start ON tasks(workspace_id, start_at);
CREATE INDEX IF NOT EXISTS idx_tasks_singleops ON tasks(singleops_task_id) WHERE singleops_task_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_tasks_updated_at();

-- RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_workspace_read" ON tasks
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "tasks_workspace_insert" ON tasks
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "tasks_workspace_update" ON tasks
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "tasks_workspace_delete" ON tasks
  FOR DELETE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
