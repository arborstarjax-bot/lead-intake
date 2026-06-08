-- Lead tab cleanup migration
-- Ensures all leads land in the correct tabs after adding:
--   - Pending tab (status = 'Pending')
--   - Lost / Not Sold reason tracking (follow_up_result stores reason)
--   - Proper outcome_badge alignment with status

-- ADD VALUE cannot run inside a transaction, so this must come first.
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'Pending';

BEGIN;

-- 1. Leads with outcome_badge = 'Sold' but status != 'Completed' → fix status
UPDATE leads
SET status = 'Completed',
    estimate_outcome = COALESCE(estimate_outcome, 'Sold'),
    status_changed_at = COALESCE(status_changed_at, updated_at, NOW())
WHERE outcome_badge = 'Sold'
  AND status != 'Completed';

-- 2. Leads with outcome_badge = 'Not Sold' but status != 'Completed' → fix status
UPDATE leads
SET status = 'Completed',
    estimate_outcome = COALESCE(estimate_outcome, 'Not Sold'),
    status_changed_at = COALESCE(status_changed_at, updated_at, NOW())
WHERE outcome_badge = 'Not Sold'
  AND status != 'Completed';

-- 3. Leads with outcome_badge = 'Lost' but status != 'Lost' → fix status
UPDATE leads
SET status = 'Lost',
    status_changed_at = COALESCE(status_changed_at, updated_at, NOW())
WHERE outcome_badge = 'Lost'
  AND status != 'Lost';

-- 4. Leads with outcome_badge = 'Waiting on Decision' → move to Pending tab
UPDATE leads
SET status = 'Pending',
    status_changed_at = COALESCE(status_changed_at, updated_at, NOW())
WHERE outcome_badge = 'Waiting on Decision'
  AND status NOT IN ('Pending', 'Completed');

-- 5. Leads with estimate_outcome = 'Sold' but no outcome_badge → backfill badge
UPDATE leads
SET outcome_badge = 'Sold'
WHERE estimate_outcome = 'Sold'
  AND (outcome_badge IS NULL OR outcome_badge = '');

-- 6. Leads with estimate_outcome = 'Not Sold' but no outcome_badge → backfill badge
UPDATE leads
SET outcome_badge = 'Not Sold'
WHERE estimate_outcome = 'Not Sold'
  AND (outcome_badge IS NULL OR outcome_badge = '');

-- 7. Active leads (New, Called / No Response, Scheduled) should not have
--    outcome badges from old data
UPDATE leads
SET outcome_badge = NULL,
    estimate_outcome = NULL
WHERE status IN ('New', 'Called / No Response', 'Scheduled')
  AND outcome_badge IS NOT NULL
  AND outcome_badge != '';

-- 8. Backfill status_changed_at for leads that still don't have it
UPDATE leads
SET status_changed_at = COALESCE(updated_at, created_at, NOW())
WHERE status_changed_at IS NULL;

COMMIT;
