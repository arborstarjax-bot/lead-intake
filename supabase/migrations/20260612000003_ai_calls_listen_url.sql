-- Add listen_url column to ai_calls for real-time call monitoring
alter table public.ai_calls add column if not exists listen_url text;
