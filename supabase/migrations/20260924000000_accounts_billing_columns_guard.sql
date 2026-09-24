-- Guard the billing columns on public.accounts against self-service edits.
--
-- THE HOLE: the only UPDATE policy on accounts is
--
--   CREATE POLICY "owners can update their account" ON public.accounts
--     FOR UPDATE
--     USING ((id = get_my_account_id()) AND (get_my_role() = 'ad'));
--
-- It has no WITH CHECK, so Postgres reuses the USING expression for the
-- check. That constrains WHICH ROW an AD may write (their own) but says
-- nothing about WHICH COLUMNS. An AD could therefore PATCH their own row
-- through the anon-key REST API and set status = 'active' — or
-- 'complimentary', which short-circuits the paywall unconditionally (see
-- 20260803000000) — granting themselves the product for free.
--
-- THE FIX: a BEFORE UPDATE trigger that rejects any change to the four
-- billing-controlled columns unless the caller is the service role. Those
-- columns are owned by api/stripe-webhook.js and by nothing else.
--
-- Deliberately mirrors the two guards already in this schema rather than
-- inventing a third shape:
--   • prevent_self_role_change      (profiles.role,          20260520000000)
--   • validate_profile_current_org_id / profiles_current_org_id_guard
--                                   (profiles.current_org_id, 20260812020000)
-- Same SECURITY DEFINER + SET search_path, same `auth.uid() IS NULL` test
-- for "this is the service role", same ERRCODE 42501 for the refusal, same
-- IS NOT DISTINCT FROM short-circuit for no-op writes.
--
-- WHY auth.uid() IS NULL IS THE RIGHT SERVICE-ROLE TEST HERE: a service-role
-- JWT carries no `sub` claim, so auth.uid() is NULL — that is exactly how
-- prevent_self_role_change lets /api/add-program through. An ANONYMOUS
-- caller also has a NULL auth.uid(), but anon never reaches this trigger:
-- the RLS policy above additionally requires get_my_role() = 'ad', which is
-- NULL for anon, so the UPDATE is refused before any trigger fires. The
-- trigger is the second layer, not the only one.
--
-- WHAT STILL WORKS:
--   • The Stripe webhook (service role) writes all four columns freely.
--   • An AD editing any OTHER column on their account row — name, tier,
--     plan_type, etc. — is untouched; the trigger returns early because
--     none of the guarded columns changed.
--   • Manual comping stays possible via SQL Editor / service role.

BEGIN;

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
  BEFORE UPDATE OF status, trial_ends_at, stripe_customer_id, stripe_subscription_id
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_billing_column_change();

COMMIT;
