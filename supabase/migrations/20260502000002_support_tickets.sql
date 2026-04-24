-- Support tab infrastructure.
--
-- David added a Support section alongside Billing/Privacy/Terms. The
-- form lets any logged-in user send a message + screenshots to support;
-- we store the ticket in the DB as the system of record and (best-effort)
-- forward it to arborstarjax@gmail.com via Resend. If the email
-- transport is misconfigured the row is still persisted so nothing is
-- silently dropped.
--
-- Screenshots go into a dedicated private bucket — they can contain
-- arbitrary user data (accidentally captured PII, device chrome, etc.)
-- and must never be publicly addressable. Server mints short-lived
-- signed URLs for the support-email body.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  -- Reply-to email for the sender. Defaults to the authenticated user's
  -- auth email at submission time but is stored separately so we still
  -- have a way to respond if the account is deleted later.
  reply_to text not null,
  subject text not null,
  message text not null,
  -- Array of `bucket/path` strings for screenshots uploaded with this
  -- ticket. Signed URLs are generated on demand — we never store the
  -- URL itself because signed URLs expire.
  screenshot_paths text[] not null default '{}',
  -- Capture the user-agent + pathname the ticket was filed from so
  -- support can reproduce browser-specific issues without needing to
  -- ask the user a second round-trip.
  user_agent text,
  source_path text,
  -- Track email delivery separately from the row insert. Nulls mean
  -- the email send was either skipped (no transport configured) or
  -- is still in flight; a value means we have a final outcome.
  email_status text check (email_status in ('sent', 'failed', 'skipped')) default null,
  email_error text,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_workspace_idx
  on public.support_tickets (workspace_id, created_at desc);

alter table public.support_tickets enable row level security;
-- No policies defined: only the service role (via /api/support) reads
-- or writes this table. Matching the rest of the app.

-- Dedicated private bucket for support screenshots. Separate from
-- `lead-screenshots` because the retention policy + access model are
-- different: support attachments are ops-internal, never customer-
-- facing, and can be purged aggressively once a ticket resolves.
insert into storage.buckets (id, name, public)
values ('support-screenshots', 'support-screenshots', false)
on conflict (id) do nothing;
