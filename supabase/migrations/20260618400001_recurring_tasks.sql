-- Add recurring task support
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end_date DATE DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end_count INTEGER DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS occurrence_index INTEGER DEFAULT NULL;

-- Index for finding children of a recurring parent
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

COMMENT ON COLUMN tasks.recurrence_rule IS 'Recurrence pattern: daily_weekdays, weekly, weekly:monday, weekly:tuesday, ..., biweekly, monthly. NULL = one-time task.';
COMMENT ON COLUMN tasks.recurrence_end_date IS 'Optional: stop generating occurrences after this date.';
COMMENT ON COLUMN tasks.recurrence_end_count IS 'Optional: stop after this many total occurrences.';
COMMENT ON COLUMN tasks.parent_task_id IS 'Links generated occurrences back to the original recurring task.';
COMMENT ON COLUMN tasks.occurrence_index IS 'Sequence number of this occurrence (1-based). NULL for non-recurring.';
