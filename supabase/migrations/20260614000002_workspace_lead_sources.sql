-- Add per-workspace lead sources so each tenant can customise their list.
-- Existing workspaces get the full historical list; new workspaces will
-- receive a generic default via the app's defaultSettings() function.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS lead_sources text[] NOT NULL DEFAULT ARRAY[
    'Facebook','Craigslist','Instagram','Close AI','Certified Lead Kings',
    'Text Message','Google Ads','Website Form','Nextdoor','Thumbtack',
    'Angi','Email','Referral','Tree Letter','Direct Mail','Other'
  ];
