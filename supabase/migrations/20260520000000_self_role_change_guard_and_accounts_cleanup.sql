-- ─────────────────────────────────────────────────────────────────────────────
-- Commit 2c — surgical DB cleanup:
--   PIECE 2 — guard against self-role-change (head_coach → ad self-promotion)
--   PIECE 5 — drop the duplicate any-member accounts UPDATE policy
--
-- PIECE 2 — Self-role-change guard
--
--   The "users can update their own profile" RLS policy has shape
--     USING (id = auth.uid())   WITH CHECK (id = auth.uid())
--   which allows a user to update ANY column on their own row — including
--   `role`. A malicious head_coach could:
--       UPDATE public.profiles SET role='ad' WHERE id = auth.uid();
--   and self-promote, bypassing every "ad and head_coach can manage
--   profiles" policy that gates non-self role changes.
--
--   We can't fix this in RLS alone: PostgreSQL doesn't expose OLD.role
--   to a WITH CHECK clause, and we don't want to drop the universal
--   self-update policy (users still need to edit their own name/email,
--   and ADs need to be able to self-demote per spec — "Don't break the
--   AD's ability to remove or demote themselves").
--
--   The fix is a BEFORE UPDATE OF role trigger that fires only when the
--   role column is being changed. The trigger inspects OLD.id vs
--   auth.uid() (is this a self-update?) and OLD.role (caller's current
--   role, which is what get_my_role() returns BEFORE the update lands):
--     • Role unchanged → pass (covers name/email-only edits — actually
--       this branch never executes because OF role limits the trigger
--       to role changes, but kept for defensive clarity).
--     • Not a self-update (auth.uid() != OLD.id) → pass. The outer RLS
--       policies still gate who can change whose role.
--     • Self-update AND caller is an AD → pass. ADs can self-demote.
--     • Self-update AND caller is anything else → RAISE 42501.
--
--   Service-role calls (auth.uid() IS NULL) skip both self-update
--   branches and pass through. This is intentional: /api/add-program's
--   service-role PATCH that promotes a head_coach to AD during the 1→2
--   upgrade must keep working.
--
-- PIECE 5 — accounts UPDATE policy cleanup
--
--   Inspect pg_policies for accounts. If there are TWO UPDATE policies —
--   one role-gated (ad only) and one broad "any account member" — drop
--   the broad one. (The audit P2 item from earlier; same shadow-policy
--   pattern Commit 1 cleaned up on other tables.) The role-gated policy
--   stays.
--
--   We don't blindly DROP — the migration checks and only DROPs the
--   broad one IF it exists, so this is idempotent across environments
--   where the cleanup already happened.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── PIECE 2: self-role-change guard ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_self_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Role unchanged: pass through. (Trigger is OF role so this branch
  -- shouldn't execute for non-role updates, but cheap belt-and-suspenders.)
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Service-role / no JWT: auth.uid() is NULL. Let it through — the
  -- /api/add-program head_coach→ad promotion must keep working.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Not a self-update — outer RLS policy decides if the caller is
  -- allowed to mutate THIS target's role.
  IF auth.uid() <> OLD.id THEN
    RETURN NEW;
  END IF;

  -- Self-update of role: only ADs are allowed (to support legitimate
  -- self-demotion). get_my_role() reads profiles.role for auth.uid(),
  -- which at BEFORE-UPDATE time is still OLD.role (the row hasn't been
  -- written yet).
  IF get_my_role() = 'ad' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Users cannot change their own role. Ask an Athletic Director to update your role.'
    USING ERRCODE = '42501';
END;
$$;

-- Idempotent install — recreate if it already exists.
DROP TRIGGER IF EXISTS prevent_self_role_change_trigger ON public.profiles;
CREATE TRIGGER prevent_self_role_change_trigger
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_role_change();

-- ── PIECE 5: drop the broad accounts UPDATE policy if present ───────────────
-- We don't know the exact name of the broad policy without first
-- inspecting the live state. The role-gated keeper is "owners can
-- update their account" (kept from migration 20260516000000 — name
-- unchanged across the rename). Any OTHER UPDATE policy on accounts is
-- a duplicate to be removed.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'accounts'
      AND cmd        = 'UPDATE'
      AND policyname <> 'owners can update their account'
  LOOP
    RAISE NOTICE 'Dropping duplicate accounts UPDATE policy: %', pol.policyname;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.accounts', pol.policyname);
  END LOOP;
END;
$$;

COMMIT;
