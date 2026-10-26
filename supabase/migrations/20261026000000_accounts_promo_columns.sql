-- accounts.promo_code + accounts.discount_amount_cents — which discount, if
-- any, this account subscribed with.
--
-- WHAT THEY ARE FOR
--   The admin dashboard needs to answer "who used which code, and what did it
--   cost us". Stripe knows, but only behind a per-subscription API call, and
--   a discount that has fully expired off a subscription stops being
--   retrievable at all. Recording the answer at the moment of purchase keeps
--   it readable forever and keeps the account table a single query.
--
--   promo_code is the human-facing code the customer typed or followed
--   (e.g. 'COACHFRIEND'), NOT the Stripe promo_xxx id — the id is meaningless
--   on a dashboard and changes if a code is recreated.
--
--   discount_amount_cents is the amount taken off, in cents, at the time of
--   purchase. Stored rather than derived because a percent-off coupon against
--   a price that later changes would re-derive to a different number.
--
-- WHY NULLABLE
--   Most accounts have no discount. NULL means "no code used", which is
--   different from 0 ("a code was used and it took nothing off") — a
--   distinction worth keeping for a 100%-off comp versus an untracked signup.
--
-- GUARDED AGAINST CLIENT WRITES
--   Both join prevent_billing_column_change alongside status, trial_ends_at,
--   stripe_customer_id, stripe_subscription_id, price_id and plan_tier.
--   These are written ONLY by api/stripe-webhook.js from the live Stripe
--   subscription. Unguarded, an AD could PATCH discount_amount_cents through
--   the anon-key REST API — which changes no entitlement today, but would
--   corrupt the revenue figures the admin dashboard reports, and the whole
--   point of that dashboard is that its numbers can be trusted.
--
--   The trigger is restated in full below rather than patched, because
--   Postgres has no "add a column to an existing trigger" operation. The
--   seven existing columns carry over verbatim from migrations
--   20260924000000, 20260924010000 and 20261009000000.

BEGIN;

-- ── 1. The columns ───────────────────────────────────────────────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS promo_code TEXT;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS discount_amount_cents INTEGER;

-- Idempotent: re-running must not fail on an existing constraint.
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_discount_amount_cents_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_discount_amount_cents_check
  CHECK (discount_amount_cents IS NULL OR discount_amount_cents >= 0);

COMMENT ON COLUMN public.accounts.promo_code IS
  'Human-facing Stripe promotion code this account subscribed with (e.g. ''COACHFRIEND''), not the promo_xxx id. NULL when no code was used. Written ONLY by api/stripe-webhook.js; protected by prevent_billing_column_change.';

COMMENT ON COLUMN public.accounts.discount_amount_cents IS
  'Amount the discount took off at purchase, in cents. NULL = no code used, which is deliberately distinct from 0. Written ONLY by api/stripe-webhook.js; protected by prevent_billing_column_change.';

-- ── 2. Extend the billing guard ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_billing_column_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- None of the guarded columns actually changed: pass through. (The
  -- trigger is UPDATE OF <cols> so this branch shouldn't execute for
  -- unrelated updates, but cheap belt-and-suspenders — and PostgREST will
  -- happily send a column set to its existing value.)
  IF NEW.status                 IS NOT DISTINCT FROM OLD.status
     AND NEW.trial_ends_at          IS NOT DISTINCT FROM OLD.trial_ends_at
     AND NEW.stripe_customer_id     IS NOT DISTINCT FROM OLD.stripe_customer_id
     AND NEW.stripe_subscription_id IS NOT DISTINCT FROM OLD.stripe_subscription_id
     AND NEW.price_id               IS NOT DISTINCT FROM OLD.price_id
     AND NEW.plan_tier              IS NOT DISTINCT FROM OLD.plan_tier
     AND NEW.promo_code             IS NOT DISTINCT FROM OLD.promo_code
     AND NEW.discount_amount_cents  IS NOT DISTINCT FROM OLD.discount_amount_cents
  THEN
    RETURN NEW;
  END IF;

  -- Service role / no JWT: auth.uid() is NULL. Let it through — this is
  -- api/stripe-webhook.js applying Stripe's view of the subscription, and
  -- the SQL Editor when a comp is granted by hand.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Anyone holding an end-user JWT — AD included — is refused.
  RAISE EXCEPTION
    'Billing columns on accounts are managed by Stripe and cannot be changed directly.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS accounts_billing_columns_guard ON public.accounts;
CREATE TRIGGER accounts_billing_columns_guard
  BEFORE UPDATE OF status, trial_ends_at, stripe_customer_id, stripe_subscription_id, price_id, plan_tier, promo_code, discount_amount_cents
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_billing_column_change();

COMMIT;
