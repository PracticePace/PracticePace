-- Add 'complimentary' to the allowed accounts.status values.
--
-- Rationale: the previous "comp" pattern was `status='active'` +
-- `trial_ends_at='2099-12-31'` + null Stripe fields (Whitesburg
-- Christian Academy). That over-loads the 'active' status semantics
-- so `SELECT count(*) WHERE status='active'` includes comps in the
-- paying-customer count and there is no UI signal to distinguish a
-- comped account from a paying one. First-class 'complimentary'
-- fixes both by giving comps their own status value.
--
-- Paywall short-circuit is added in app code (Dashboard.jsx +
-- SettingsSection.jsx) in the same commit — the app never renders
-- the paywall for a complimentary account regardless of
-- trial_ends_at, stripe_customer_id, or any other field.
--
-- No default value change; new accounts still start at 'trialing'.
-- Complimentary is only set manually via SQL for known comped rows.

BEGIN;

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_status_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_status_check
  CHECK (status = ANY (ARRAY[
    'trialing'::text,
    'active'::text,
    'canceled'::text,
    'past_due'::text,
    'complimentary'::text
  ]));

COMMIT;
