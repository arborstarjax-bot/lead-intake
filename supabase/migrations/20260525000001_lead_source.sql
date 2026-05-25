-- Add lead_source column to track where leads originated from (AI-detected).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source text;
