-- Add accounts.price_id and bring it under the billing guard.
--
-- WHY THE COLUMN IS NEW: `price_id` already existed, but on the `subscriptions`
-- table (supabase-schema.sql ~line 309) — a vestigial table with zero
-- references left in src/ or api/. accounts has never had it. That is why
-- SettingsSection's `PRICE_LABELS[sub.price_id]` lookup has always missed:
-- `sub` is the accounts row, so sub.price_id is undefined and the label
-- silently falls through to the plan_type branch every time.
--
-- WHY WE NEED IT: what a customer actually bought is only knowable from
-- Stripe. accounts.plan_type can't answer it — it is derived from the org
-- count by add-program/delete-program (circular: it is written BY the action
-- we want to gate), and its initial value comes from a caller-supplied
-- `planType` in the unauthenticated /api/create-account. Persisting the Stripe
-- price id gives the program cap a trustworthy input.
--
-- WHY IT JOINS THE GUARD: once api/stripe-webhook.js writes this column it is
-- Stripe-owned, exactly like status / trial_ends_at / stripe_customer_id /
-- stripe_subscription_id. Left outside the guard, an AD could PATCH
-- price_id to the School price through the anon-key REST API and lift their
-- own cap — reintroducing the bypass one column over.
--
-- The function body and trigger are otherwise unchanged from
-- 20260924000000; this recreates both with price_id folded in. Safe to re-run.

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS price_id text;

COMMENT ON COLUMN public.accounts.price_id IS
  'Stripe Price id of the active subscription, written only by api/stripe-webhook.js. Ground truth for the program cap. Guarded by accounts_billing_columns_guard.';

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
  BEFORE UPDATE OF status, trial_ends_at, stripe_customer_id, stripe_subscription_id, price_id
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_billing_column_change();

COMMIT;
