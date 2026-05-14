-- ─────────────────────────────────────────────────────────────────────────────
-- Commit 2b — program-scoped isolation for organizations + profiles,
--             and storage.objects org-scoping for the backgrounds bucket.
--
-- WHAT IS CHANGING:
--
--   PIECE 1 — organizations RLS:
--     • SELECT: AD sees all orgs in their account (school-wide). Anyone else
--       (head_coach / assistant_coach / team_manager) sees only the single
--       org their profile.org_id points to.
--     • INSERT: ONLY 'ad' can create new orgs. Head coaches no longer can —
--       new programs are added via the /api/add-program flow which a head
--       coach invokes for the 1→2 transition (server-side promotes them
--       to AD), or an AD invokes directly. RLS no longer enables this.
--     • UPDATE: AD account-wide; head_coach own-org only. Assistant_coach
--       and team_manager cannot update orgs at all.
--     • DELETE: same shape as UPDATE.
--
--   PIECE 2 — profiles RLS:
--     • Self-SELECT (id = auth.uid()) — universal, untouched. This is the
--       bootstrap policy every app load depends on (AuthContext fetches the
--       user's own profile before anything else; get_my_role() also reads
--       it via SECURITY DEFINER but the policy here is what unlocks the
--       direct client SELECT).
--     • Scoped SELECT for non-self profiles: AD sees account-wide,
--       head_coach sees own-org-only, others see nobody but themselves.
--     • Manage (ALL = INSERT/UPDATE/DELETE) for ad+head_coach, scoped the
--       same way.
--
--   PIECE 5 — storage.objects backgrounds bucket:
--     • Drop the wide-open INSERT/UPDATE policies that allowed any
--       authenticated user to write any path under bucket_id='backgrounds'.
--     • Recreate with org-scoping: split_part(name, '/', 1) must match the
--       caller's profile.org_id (same shape as the existing music bucket).
--     • Add an AD override: an AD can write to ANY org in their account
--       (needed for the Add-Program flow to upload a background to a sibling
--       program before that program has a head_coach). The music bucket
--       does NOT have this override yet — left alone to keep this commit
--       focused. ADs handing music to a sibling program is rare in practice
--       (head_coaches own day-to-day program content).
--     • Add a DELETE policy with the same scoping shape (previously
--       missing).
--
-- WHAT IS NOT CHANGING:
--   • Other tables' RLS (scripts, drills, songs, videos, whiteboards,
--     scoreboard_configs, backgrounds-the-table, accounts). Those are
--     already org-scoped via get_my_org_id() — no school-wide leak.
--   • The music bucket policies.
--   • get_my_role() / get_my_account_id() / get_my_org_id() helpers.
--   • Role values — Commit 2a renamed them; we use the new values here.
--   • AuthContext or anything else under src/. (Code changes for the
--     switcher and Add-Program flow ship in the same commit but as
--     separate files; this migration is DB-only.)
--
-- VERIFICATION (post-apply): see the queries at the bottom of this file as
-- comments. The maintainer's Albertville Aggies account is a real
-- multi-program account perfect for this — it has both a Football and
-- a Basketball program in the same account, with the Basketball head
-- coach previously able to read/write Football data. After this
-- migration, that head coach should see ONLY Basketball.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ============================================================================
-- PIECE 1 — organizations RLS
-- ============================================================================

-- SELECT: AD sees all in account; everyone else only own org
DROP POLICY IF EXISTS "members can view orgs in their account" ON public.organizations;
DROP POLICY IF EXISTS "members can view orgs in their scope" ON public.organizations;
CREATE POLICY "members can view orgs in their scope"
  ON public.organizations
  FOR SELECT
  USING (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (id = get_my_org_id())
  );

-- INSERT: only AD (head_coach no longer; new programs go through
-- /api/add-program which uses service_role for the 1→2 transition)
DROP POLICY IF EXISTS "owners and admins can insert orgs" ON public.organizations;
DROP POLICY IF EXISTS "ad can insert orgs" ON public.organizations;
CREATE POLICY "ad can insert orgs"
  ON public.organizations
  FOR INSERT
  WITH CHECK (
    get_my_role() = 'ad'
    AND account_id = get_my_account_id()
  );

-- UPDATE: AD account-wide; head_coach own-org only
DROP POLICY IF EXISTS "owners and admins can update orgs" ON public.organizations;
DROP POLICY IF EXISTS "ad and head_coach can update orgs" ON public.organizations;
CREATE POLICY "ad and head_coach can update orgs"
  ON public.organizations
  FOR UPDATE
  USING (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (get_my_role() = 'head_coach' AND id = get_my_org_id())
  )
  WITH CHECK (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (get_my_role() = 'head_coach' AND id = get_my_org_id())
  );

-- DELETE: same shape as UPDATE
DROP POLICY IF EXISTS "ad and head_coach can delete orgs" ON public.organizations;
CREATE POLICY "ad and head_coach can delete orgs"
  ON public.organizations
  FOR DELETE
  USING (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (get_my_role() = 'head_coach' AND id = get_my_org_id())
  );

-- ============================================================================
-- PIECE 2 — profiles RLS
-- ============================================================================

-- Self-SELECT: universal. Keep/recreate so we know exactly what it looks like.
DROP POLICY IF EXISTS "users can view their own profile" ON public.profiles;
CREATE POLICY "users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

-- Scoped SELECT for non-self rows
DROP POLICY IF EXISTS "members can view profiles in their account" ON public.profiles;
DROP POLICY IF EXISTS "members can view profiles in their scope" ON public.profiles;
CREATE POLICY "members can view profiles in their scope"
  ON public.profiles
  FOR SELECT
  USING (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (get_my_role() = 'head_coach' AND org_id = get_my_org_id())
  );

-- "users can update their own profile" (id = auth.uid()) policy is left
-- in place — already named correctly, no change required.

-- Manage (ALL = INSERT/UPDATE/DELETE) for ad+head_coach, scoped
DROP POLICY IF EXISTS "owners and admins can manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "ad and head_coach can manage profiles" ON public.profiles;
CREATE POLICY "ad and head_coach can manage profiles"
  ON public.profiles
  FOR ALL
  USING (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (get_my_role() = 'head_coach' AND org_id = get_my_org_id())
  )
  WITH CHECK (
    (get_my_role() = 'ad' AND account_id = get_my_account_id())
    OR (get_my_role() = 'head_coach' AND org_id = get_my_org_id())
  );

-- ============================================================================
-- PIECE 5 — storage.objects: backgrounds bucket org-scoping
-- ============================================================================

-- Drop the existing wide-open writes
DROP POLICY IF EXISTS "Authenticated users can upload backgrounds" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update backgrounds" ON storage.objects;

-- INSERT: caller's profile.org_id must be the first path segment, OR
-- caller is an AD writing to any org under their own account.
DROP POLICY IF EXISTS "Authenticated users can upload backgrounds to own org" ON storage.objects;
CREATE POLICY "Authenticated users can upload backgrounds to own org"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'backgrounds'
    AND (
      split_part(name, '/', 1) = (
        SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
      )
      OR (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'ad'
        AND split_part(name, '/', 1) IN (
          SELECT id::text FROM public.organizations
          WHERE account_id = (SELECT account_id FROM public.profiles WHERE id = auth.uid())
        )
      )
    )
  );

-- UPDATE: same shape (covers the upsert path our client uses on background
-- replacement — Supabase storage upserts emit both INSERT and UPDATE).
DROP POLICY IF EXISTS "Authenticated users can update own org backgrounds" ON storage.objects;
CREATE POLICY "Authenticated users can update own org backgrounds"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'backgrounds'
    AND (
      split_part(name, '/', 1) = (
        SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
      )
      OR (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'ad'
        AND split_part(name, '/', 1) IN (
          SELECT id::text FROM public.organizations
          WHERE account_id = (SELECT account_id FROM public.profiles WHERE id = auth.uid())
        )
      )
    )
  );

-- DELETE: previously missing — add one with the same scope so a coach
-- can actually unhang a stale background instead of orphaning it.
DROP POLICY IF EXISTS "Authenticated users can delete own org backgrounds" ON storage.objects;
CREATE POLICY "Authenticated users can delete own org backgrounds"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'backgrounds'
    AND (
      split_part(name, '/', 1) = (
        SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
      )
      OR (
        (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'ad'
        AND split_part(name, '/', 1) IN (
          SELECT id::text FROM public.organizations
          WHERE account_id = (SELECT account_id FROM public.profiles WHERE id = auth.uid())
        )
      )
    )
  );

-- "Public can read backgrounds" SELECT policy is unchanged — existing
-- background URLs continue to load even though the legacy paths
-- (org-<uuid>/... and logos/<uuid>/...) are now write-orphans.

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION (run these manually as different users):
--
-- 1. As Football head_coach (a3e91bdd-...) — should see ONLY Football:
--      select id, name from organizations;
--      select id, role, full_name from profiles where id != auth.uid();
--
-- 2. As Basketball head_coach (2806fb57-...) — should see ONLY Basketball:
--      select id, name from organizations;
--      select id, role, full_name from profiles where id != auth.uid();
--
-- 3. As Albertville AD (56e17607-...) — should see BOTH programs and
--    BOTH staff lists across them:
--      select id, name from organizations;
--      select id, role, full_name from profiles where id != auth.uid();
--
-- 4. As any team_manager — should see no other-staff profiles, and only
--    their own org row.
-- ─────────────────────────────────────────────────────────────────────────────
