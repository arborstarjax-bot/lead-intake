-- Track when each Stripe webhook has been successfully processed so we
-- can safely retry failed handlers without losing events.
--
-- Before: the webhook route inserted into billing_events on receipt,
-- and on handler error DELETED the row so Stripe's retry could re-insert.
-- If that DELETE itself failed (DB blip), the event was silently dropped
-- forever — the next retry saw the row, assumed success, and returned
-- 200 without processing. A lapsed subscription could stay "active".
--
-- After: billing_events rows are never deleted. The webhook inserts on
-- receipt (processed_at=null), runs the handler, and updates
-- processed_at=now() on success. On retry, the route checks
-- processed_at: non-null means already handled, null means an earlier
-- attempt failed and it's safe to re-run the handler.

alter table public.billing_events
  add column if not exists processed_at timestamptz;

-- Backfill: any rows that already exist have by definition been
-- processed (the old flow returned 200 immediately after handler
-- success). Stamp them so the guard treats them as done.
update public.billing_events
  set processed_at = created_at
  where processed_at is null;

create index if not exists billing_events_unprocessed_idx
  on public.billing_events (created_at)
  where processed_at is null;
