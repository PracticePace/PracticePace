-- Durability log for Stripe webhook delivery: idempotency + ordering.
--
-- WHAT IT SOLVES
--   1. Idempotency. Stripe redelivers events. event_id is Stripe's own evt_...
--      identifier and is stable across redeliveries, so a PRIMARY KEY on it
--      lets the handler recognise a replay and skip it.
--   2. Ordering. Stripe does not guarantee delivery order, so a stale
--      customer.subscription.updated could overwrite a newer status — e.g.
--      resurrecting 'active' over a later 'canceled'. event_created is
--      compared against the newest event already recorded for the same
--      stripe_customer_id, and older events are ignored.
--
-- WHY NOT A COLUMN ON accounts
--   An ordering timestamp on accounts would have to join
--   accounts_billing_columns_guard as a sixth guarded column — otherwise an AD
--   could PATCH it far into the future through the anon-key REST API and
--   permanently freeze their own subscription status against every subsequent
--   webhook write. Keeping the timestamp here means the guard (verified in
--   20260924000000 and 20260924010000) needs no changes at all.
--
-- WRITE ORDER MATTERS
--   api/stripe-webhook.js records the row only AFTER the accounts write
--   succeeds. Recording first would mean a failed write plus a 5xx retry sees
--   "already processed" and skips forever — turning a transient blip into
--   permanent silent loss, which is the whole bug this work exists to fix.
--   The cost of recording after is that a concurrent duplicate delivery may
--   apply twice; every write in the handler is an idempotent "set column to X",
--   so that is harmless.
--
-- ACCESS
--   RLS is enabled with NO policies, deliberately. PostgREST then denies every
--   anon/authenticated request while the service role continues to bypass RLS.
--   This is a security boundary, not bookkeeping: a user who could INSERT here
--   could fabricate a future-dated row and freeze their own subscription status
--   forever, and a user who could DELETE could force replays.
--
-- RETENTION
--   Unbounded by decision (2026-09-24) — event volume is near zero and a
--   cleanup job nobody remembers is worse than a slowly growing table. Known
--   future item; a `DELETE ... WHERE processed_at < now() - interval '90 days'`
--   is the shape when it is wanted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id           TEXT PRIMARY KEY,
  event_type         TEXT NOT NULL,
  event_created      TIMESTAMPTZ NOT NULL,
  stripe_customer_id TEXT,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves the ordering lookup: newest event_created for one customer.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_customer_created
  ON public.stripe_webhook_events (stripe_customer_id, event_created DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- Belt and braces. RLS-with-no-policies already denies anon/authenticated, but
-- that guarantee then rests on Supabase's default privileges being what we
-- assume. Revoking the table grants outright means the denial holds even if a
-- policy is ever added to this table by mistake. service_role is untouched and
-- bypasses RLS regardless.
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;

COMMENT ON TABLE public.stripe_webhook_events IS
  'Processed Stripe webhook events. event_id gives idempotency across redeliveries; event_created gives per-customer ordering. Written by api/stripe-webhook.js only, AFTER a successful accounts write. RLS on with no policies = service-role only. Retention is deliberately unbounded (2026-09-24); periodic cleanup is a known future item.';

COMMIT;
