-- Convert lead_activities.type from a PostgreSQL enum to plain text.
--
-- The enum approach requires a migration every time a new activity type is
-- added, and ALTER TYPE … ADD VALUE can behave oddly inside transactions on
-- older Postgres versions. Switching to text removes that friction — the
-- application-level LEAD_ACTIVITY_TYPES constant is the single source of
-- truth for valid types, and the column simply stores whatever string the
-- server writes.

-- Step 1: add a temporary text column
alter table public.lead_activities add column type_text text;

-- Step 2: copy existing enum values as text
update public.lead_activities set type_text = type::text;

-- Step 3: drop the old enum column and rename
alter table public.lead_activities drop column type;
alter table public.lead_activities rename column type_text to type;

-- Step 4: add NOT NULL constraint
alter table public.lead_activities alter column type set not null;
