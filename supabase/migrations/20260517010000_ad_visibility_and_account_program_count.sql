-- ─────────────────────────────────────────────────────────────────────────────
-- Commit 2b follow-up — two surgical patches on top of
-- 20260517000000_program_scoped_isolation_and_storage.sql:
--
--   FIX 1: Make ADs visible to everyone in their account.
--     The profile SELECT policy from the previous migration showed
--     head_coaches only same-org rows. That works when the AD happens
--     to be in the head_coach's org (today's case for Albertville —
--     mbrooks0918's profile.org_id = Football matches Winegarden's
--     org_id), but it breaks the moment the AD's pinned org is a
--     different program. ADs are *school-wide* by definition; the
--     policy should reflect that, not depend on a coincidental org_id
--     match.
--
--     We add a third OR clause to the existing "members can view
--     profiles in their scope" SELECT policy:
--           OR (role = 'ad' AND account_id = get_my_account_id())
--     i.e. any account member can see *AD* profiles in their account.
--     This does NOT widen visibility to other roles (head_coach,
--     assistant_coach, team_manager are still scoped per the existing
--     branches).
--
--     Side-effects of the new clause, by viewer role:
--       • ad           — no change (AD branch already returns all
--                        profiles in account; the new clause is a
--                        subset).
--       • head_coach   — gains visibility of ADs scoped to other
--                        programs in the same account.
--       • assistant_coach / team_manager — gain visibility of ADs
--                        (they could previously see only themselves).
--                        This is intentional: every coach should know
--                        who their AD is.
--
--   FIX 2: SECURITY DEFINER helper get_my_account_program_count().
--     The "Athletic Director" vs "Head Coach" friendly-label decision
--     for role='ad' depends on whether the *account* has 2+ programs.
--     The viewer's allOrgs.length is the wrong signal — it's
--     RLS-filtered per role, so a head_coach who can only see their
--     own org reads programCount=1 even when the account has 5
--     programs. The new helper bypasses the org SELECT RLS (it's
--     SECURITY DEFINER) to count every org under the caller's
--     account, and is callable from any signed-in user session via
--     supabase.rpc('get_my_account_program_count').
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── FIX 1: AD visibility on profiles SELECT ─────────────────────────────────
DROP POLICY IF EXISTS "members can view profiles in their scope" ON public.profiles;
CREATE POLICY "members can view profiles in their scope"
  ON public.profiles
  FOR SELECT
  USING (
    -- AD viewer: account-wide (unchanged).
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    -- Head coach viewer: same-org (unchanged).
    OR (get_my_role() = 'head_coach' AND org_id = get_my_org_id())
    -- New: ANY account member can see AD profiles in their account.
    -- The AD is school-wide by definition; everyone in the account
    -- should know who their AD is.
    OR (role = 'ad' AND account_id = get_my_account_id())
  );

-- ── FIX 2: account-wide program count helper ────────────────────────────────
-- SECURITY DEFINER lets this bypass the org SELECT RLS, which is
-- per-role-scoped (an AD sees all account orgs, head_coach only their
-- own, etc.). The function uses auth.uid() to pin the result to the
-- caller's account — no SQL injection vector — and is marked STABLE so
-- it can be folded into other RLS expressions or query plans if we
-- later need to.
--
-- search_path is pinned to public so a malicious schema in the
-- session path can't shadow profiles/organizations and trick the
-- definer rights.
CREATE OR REPLACE FUNCTION public.get_my_account_program_count()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT count(*)::int
  FROM public.organizations
  WHERE account_id = (
    SELECT account_id FROM public.profiles WHERE id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_my_account_program_count() TO authenticated;
-- Anon doesn't need this — anon users have no profile, the inner
-- subquery returns NULL, and count(*) WHERE account_id = NULL = 0. We
-- still don't grant it to anon explicitly, on principle.

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION:
--
-- A. As Winegarden (head_coach of Football, account=Albertville), the
--    profile listing should still include mbrooks0918 (the AD). It did
--    before this migration via the org_id coincidence; it now does
--    via the explicit AD-in-account clause. If you change
--    mbrooks0918's org_id to Girls Basketball (no need to — just
--    hypothetical), Winegarden should STILL see mbrooks0918 thanks
--    to the new clause.
--
-- B. As Winegarden, select get_my_account_program_count() — should
--    return 2 (Football + Girls Basketball), not 1 (which is what
--    his allOrgs view returns).
--
-- C. Cross-account isolation: a head_coach in a different account
--    must NOT see this AD. The "account_id = get_my_account_id()"
--    guard in the new clause enforces that.
-- ─────────────────────────────────────────────────────────────────────────────
