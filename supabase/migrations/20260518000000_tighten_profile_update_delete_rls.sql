-- ─────────────────────────────────────────────────────────────────────────────
-- Tighten profiles UPDATE/DELETE RLS so a head_coach cannot remove or
-- demote an AD, and cannot reach across programs even if the AD's pinned
-- profile.org_id happens to match their own.
--
-- WHAT WAS WRONG
--   The single FOR ALL policy from migration 20260517000000 (renamed to
--   the program-scoped model in Commit 2b) had no target-role guard
--   inside the head_coach branch:
--
--     ((get_my_role() = 'ad'  AND account_id = get_my_account_id())
--      OR (get_my_role() = 'head_coach' AND org_id = get_my_org_id()))
--
--   The Albertville AD (mbrooks0918) is pinned to org_id = Football. A
--   head_coach in Football (Winegarden) matches the second branch on
--   the AD's row, so Winegarden could DELETE or UPDATE the AD. He could
--   demote the AD to assistant_coach (effective removal — the AD loses
--   billing, switcher, etc.) or just nuke the row.
--
-- WHAT WE'RE CHANGING
--   1. DROP the FOR ALL policy.
--   2. Recreate as three policies (INSERT, UPDATE, DELETE) that all add
--      `AND role <> 'ad'` to the head_coach branch. AD-managed rows now
--      need the AD viewer branch.
--   3. UPDATE additionally enforces the WITH CHECK against the AFTER
--      state, so a head_coach also can't promote a non-AD to AD via
--      this endpoint (the after-state role would be 'ad', which fails
--      the same `role <> 'ad'` guard on the head_coach branch).
--
-- WHAT WE'RE NOT CHANGING
--   • The "users can update their own profile" (id = auth.uid()) policy.
--     A user can still update their own row, including name/email and
--     (today, by design) their own role. Self-promotion to AD is a
--     known pre-existing channel that's intentionally NOT in scope for
--     this commit — the spec was about removing/demoting OTHERS.
--   • The "users can view their own profile" + "members can view
--     profiles in their scope" SELECT policies. Read-side stays as-is.
--   • The AD account-wide model. AD can remove or demote anyone in
--     their account, including other ADs (we explicitly do NOT block
--     an AD from removing the last AD at the policy layer — the UI
--     can warn; locking the policy is a footgun if AD recovery is
--     needed).
--
-- ROLES (post-Commit-2a):
--   ad / head_coach / assistant_coach / team_manager
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Drop the FOR ALL policy that covered INSERT/UPDATE/DELETE without a
-- target-role guard.
DROP POLICY IF EXISTS "ad and head_coach can manage profiles" ON public.profiles;

-- ── INSERT ──────────────────────────────────────────────────────────────────
-- AD can insert any profile in their account.
-- head_coach can insert non-AD profiles in their own org. (The
-- onboarding/invite flows go through service-role API endpoints today,
-- so this policy mostly matters for defense-in-depth.)
DROP POLICY IF EXISTS "ad and head_coach can insert profiles" ON public.profiles;
CREATE POLICY "ad and head_coach can insert profiles"
  ON public.profiles
  FOR INSERT
  WITH CHECK (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  );

-- ── UPDATE ──────────────────────────────────────────────────────────────────
-- USING gates which rows the viewer can target.
-- WITH CHECK gates what the row can look like AFTER the update.
-- For a head_coach, BOTH the before-state row's role and the after-state
-- row's role must be <> 'ad' — so a head_coach can't promote a non-AD
-- target to AD via this policy. They also stay org-scoped on both sides.
--
-- Note: the universal "users can update their own profile" policy is
-- OR'd alongside this one, so an AD updating their own role still works
-- via the self-update channel (per spec — AD must be able to demote
-- themselves if they choose).
DROP POLICY IF EXISTS "ad and head_coach can update profiles" ON public.profiles;
CREATE POLICY "ad and head_coach can update profiles"
  ON public.profiles
  FOR UPDATE
  USING (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  )
  WITH CHECK (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  );

-- ── DELETE ──────────────────────────────────────────────────────────────────
-- AD: account-wide. head_coach: same-org non-AD only.
DROP POLICY IF EXISTS "ad and head_coach can delete profiles" ON public.profiles;
CREATE POLICY "ad and head_coach can delete profiles"
  ON public.profiles
  FOR DELETE
  USING (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION:
--
--   1. As Winegarden (head_coach Football), attempt DELETE on mbrooks0918
--      (AD on the same Football org_id):
--          DELETE FROM public.profiles WHERE id = '<mbrooks0918 id>';
--      Expected: 0 rows deleted. USING fails because target.role='ad'.
--
--   2. As Winegarden, attempt UPDATE on mbrooks0918 to anything:
--          UPDATE public.profiles SET role='team_manager'
--          WHERE id = '<mbrooks0918 id>';
--      Expected: 0 rows updated. USING fails before WITH CHECK is even
--      evaluated.
--
--   3. As Winegarden, attempt UPDATE on a same-org assistant_coach to
--      role='ad':
--          UPDATE public.profiles SET role='ad'
--          WHERE id = '<some assistant id>';
--      Expected: WITH CHECK violation — the after-state role='ad' fails
--      the head_coach branch.
--
--   4. As AD (mbrooks0918), attempt DELETE on Winegarden (head_coach
--      in same account):
--          DELETE FROM public.profiles WHERE id = '<winegarden id>';
--      Expected: 1 row deleted (then ROLLBACK). USING passes via AD
--      branch.
--
--   5. As AD, attempt DELETE on Patrick (AD in different account):
--      Expected: 0 rows deleted (cross-account isolation, AD branch
--      requires account_id match).
-- ─────────────────────────────────────────────────────────────────────────────
