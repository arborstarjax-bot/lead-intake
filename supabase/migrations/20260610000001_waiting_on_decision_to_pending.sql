-- Migrate any leads with "Waiting on Decision" to Pending status/badge.
-- Safe to run multiple times (idempotent).

BEGIN;

-- Move leads whose outcome_badge is "Waiting on Decision" to Pending
UPDATE leads
SET status         = 'Pending',
    outcome_badge  = 'Pending',
    status_changed_at = COALESCE(status_changed_at, updated_at, NOW())
WHERE outcome_badge = 'Waiting on Decision';

-- Also catch any with estimate_outcome still set to "Waiting on Decision"
UPDATE leads
SET estimate_outcome = 'Pending'
WHERE estimate_outcome = 'Waiting on Decision';

-- Catch follow_up_result references
UPDATE leads
SET follow_up_result = NULL
WHERE follow_up_result = 'Waiting on Decision';

COMMIT;
