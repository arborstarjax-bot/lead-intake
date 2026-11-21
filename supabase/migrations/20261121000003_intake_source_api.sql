-- Allow 'api' as an intake source so leads created through /api/v1
-- (ingest, POST /leads) are attributed to the API rather than 'manual'.
alter type lead_intake_source add value if not exists 'api';
