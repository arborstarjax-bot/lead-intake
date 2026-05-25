-- Lead type classification
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_type text;

-- Estimate outcome tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimate_outcome text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS no_proposal_reason text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS no_proposal_notes text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_result text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_notes text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome_badge text;
