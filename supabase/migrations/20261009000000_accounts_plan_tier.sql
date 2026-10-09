-- accounts.plan_tier — which of the two published plans this account bought.
--
-- WHAT IT IS FOR
--   Entitlement decisions (api/_entitlements.js) need to know the tier, and
--   until now the only signal was accounts.price_id compared against a list of
--   Stripe price IDs held in environment variables. That works but couples
--   every read to the current contents of the environment: rotate a price in
--   Stripe and historical rows stop resolving. plan_tier records the ANSWER at
--   the moment the subscription was written, so a price rotation does not
--   retroactively un-tier existing customers.
--
--   price_id stays as the audit trail of exactly which Stripe price was
--   charged. plan_tier is the derived, stable fact we gate on.
--
-- WHY NULLABLE
--   Three legitimate states have no tier:
--     • a trialing account that has not chosen a plan yet
--     • a 'complimentary' account (comped programs, founding customers,
--       testimonial partners) — these never go through Stripe at all
--     • a canceled account whose subscription was deleted
--   A NOT NULL default would have to invent a tier for all three.
--
-- WHY THE CHECK CONSTRAINT MATTERS
--   The plan keys exist in three places: PLAN_KEYS in src/lib/plans.js,
--   PLAN_ENV_VARS in api/_entitlements.js, and here. This constraint is the
--   backstop for that duplication — a key that drifts in either JS file cannot
--   be written to the database, so drift surfaces as a loud write failure in
--   the webhook rather than as an account silently entitled to nothing.
--
-- GUARDED AGAINST CLIENT WRITES
--   plan_tier is added to prevent_billing_column_change, joining status,
--   trial_ends_at, stripe_customer_id, stripe_subscription_id and price_id.
--   Without this an AD could PATCH plan_tier='school' through the anon-key
--   REST API and grant themselves unlimited programs — the cap in
--   api/add-program.js reads this column, so leaving it unguarded would make
--   the enforcement added in the same commit self-serve bypassable.
--
--   The trigger is recreated in full below rather than patched, because
--   Postgres has no "add a column to an existing trigger function" operation.
--   The six existing columns are carried over verbatim from migrations
--   20260924000000 and 20260924010000.

BEGIN;

-- ── 1. The column ────────────────────────────────────────────────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS plan_tier TEXT;

-- Idempotent: re-running the migration must not fail on an existing constraint.
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_plan_tier_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_plan_tier_check
  CHECK (plan_tier IS NULL OR plan_tier IN ('individual', 'school'));

COMMENT ON COLUMN public.accounts.plan_tier IS
  'Which published plan this account bought: ''individual'' ($699/yr, 1 program) or ''school'' ($1,199/yr, unlimited). Written ONLY by api/stripe-webhook.js from the price on the live Stripe subscription; read by api/_entitlements.js to decide the program cap. NULL for trialing, complimentary and canceled accounts. Protected by prevent_billing_column_change.';

-- ── 2. Extend the billing guard to cover it ──────────────────────────────────
-- This is migrations 20260924000000 + 20260924010000's trigger, verbatim, with
-- plan_tier added in the two places it has to appear: the no-change early
-- return inside the function, and the UPDATE OF column list on the trigger
-- itself. Postgres has no "add a column to an existing trigger" operation, so
-- the whole thing is restated rather than patched.
--
-- Both places matter. The column list is what makes the trigger fire at all;
-- the IS NOT DISTINCT FROM list is what lets an unrelated UPDATE that happens
-- to include plan_tier at its current value pass through (PostgREST sends full
-- column sets). Adding plan_tier to only one of the two would either never
-- guard the column or reject harmless no-op writes.
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
  BEFORE UPDATE OF status, trial_ends_at, stripe_customer_id, stripe_subscription_id, price_id, plan_tier
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_billing_column_change();

COMMIT;
