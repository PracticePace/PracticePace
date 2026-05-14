-- ─────────────────────────────────────────────────────────────────────────────
-- Commit 2a — rename profiles.role values to athletic terminology
--
-- Mapping:
--   owner    → ad
--   admin    → head_coach
--   coach    → assistant_coach
--   readonly → team_manager
--
-- This is a RENAME-ONLY migration. No permission boundaries change — every
-- policy that gated 'owner/admin/coach' before now gates 'ad/head_coach/
-- assistant_coach' with byte-identical logic. The split (admins-only vs
-- coaches-and-above vs any-member-read) is unchanged.
--
-- What this touches:
--   1. profiles.role data values (UPDATE)                       — 6 rows live
--   2. profiles.role column DEFAULT ('coach' → 'assistant_coach')
--   3. profiles_role_check constraint (rewrite the allowed list)
--   4. 18 RLS policies across accounts / backgrounds /
--      organizations / profiles / scoreboard_configs / scripts /
--      songs / videos / whiteboards (DROP + CREATE per policy)
--
-- What this does NOT touch:
--   - get_my_role()        — reads profiles.role transparently, no hardcoded
--                            role names, so it picks up the new values
--                            automatically.
--   - get_my_account_id()  — unrelated to role values.
--   - get_my_org_id()      — unrelated to role values.
--   - Any non-role policy.
--   - Cross-program isolation behavior (separate commit 2b).
--
-- Ordering note: we DROP the CHECK constraint BEFORE the UPDATE so the
-- intermediate states ('ad', 'head_coach', …) don't violate the old
-- constraint mid-migration, then recreate it with the new allowed list.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. profiles.role data + constraint + default ────────────────────────────

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

UPDATE public.profiles SET role = 'ad'              WHERE role = 'owner';
UPDATE public.profiles SET role = 'head_coach'      WHERE role = 'admin';
UPDATE public.profiles SET role = 'assistant_coach' WHERE role = 'coach';
UPDATE public.profiles SET role = 'team_manager'    WHERE role = 'readonly';

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'assistant_coach';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text, 'team_manager'::text]));

-- ── 2. RLS policy rewrites ──────────────────────────────────────────────────
-- Pattern: DROP POLICY IF EXISTS ... ; CREATE POLICY ... with same name and
-- same logic, just with renamed role values. We keep the policy NAMES the
-- same so anyone grepping the codebase for "admins and above can delete
-- scripts" still finds the live policy.

-- accounts: ad can update their account (was: owner)
DROP POLICY IF EXISTS "owners can update their account" ON public.accounts;
CREATE POLICY "owners can update their account" ON public.accounts
  FOR UPDATE
  USING ((id = get_my_account_id()) AND (get_my_role() = 'ad'));

-- backgrounds: head_coach+ad can manage backgrounds (was: owner/admin)
DROP POLICY IF EXISTS "admins and above can manage backgrounds" ON public.backgrounds;
CREATE POLICY "admins and above can manage backgrounds" ON public.backgrounds
  FOR ALL
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])))
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])));

-- organizations: head_coach+ad can insert (was: owner/admin)
DROP POLICY IF EXISTS "owners and admins can insert orgs" ON public.organizations;
CREATE POLICY "owners and admins can insert orgs" ON public.organizations
  FOR INSERT
  WITH CHECK ((account_id = get_my_account_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])));

-- organizations: head_coach+ad can update (was: owner/admin)
DROP POLICY IF EXISTS "owners and admins can update orgs" ON public.organizations;
CREATE POLICY "owners and admins can update orgs" ON public.organizations
  FOR UPDATE
  USING (account_id = get_my_account_id())
  WITH CHECK (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text]));

-- profiles: head_coach+ad can manage profiles (was: owner/admin)
DROP POLICY IF EXISTS "owners and admins can manage profiles" ON public.profiles;
CREATE POLICY "owners and admins can manage profiles" ON public.profiles
  FOR ALL
  USING ((account_id = get_my_account_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])))
  WITH CHECK ((account_id = get_my_account_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])));

-- scoreboard_configs: assistant_coach+ can manage (was: owner/admin/coach)
DROP POLICY IF EXISTS "coaches and above can manage scoreboard configs" ON public.scoreboard_configs;
CREATE POLICY "coaches and above can manage scoreboard configs" ON public.scoreboard_configs
  FOR ALL
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])))
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

-- scripts: head_coach+ad can delete (was: owner/admin)
DROP POLICY IF EXISTS "admins and above can delete scripts" ON public.scripts;
CREATE POLICY "admins and above can delete scripts" ON public.scripts
  FOR DELETE
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])));

-- scripts: assistant_coach+ can insert (was: owner/admin/coach)
-- Note: this policy uses inline subqueries (not get_my_role()) for historical
-- reasons — preserved as-is, just renamed values.
DROP POLICY IF EXISTS "coaches and above can insert scripts" ON public.scripts;
CREATE POLICY "coaches and above can insert scripts" ON public.scripts
  FOR INSERT
  WITH CHECK (
    (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
    AND ((SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid())
         = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text]))
  );

-- scripts: assistant_coach+ can update (was: owner/admin/coach)
DROP POLICY IF EXISTS "coaches and above can update scripts" ON public.scripts;
CREATE POLICY "coaches and above can update scripts" ON public.scripts
  FOR UPDATE
  USING (org_id = get_my_org_id())
  WITH CHECK (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text]));

-- songs: assistant_coach+ INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "songs_delete_coach_or_above" ON public.songs;
CREATE POLICY "songs_delete_coach_or_above" ON public.songs
  FOR DELETE
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

DROP POLICY IF EXISTS "songs_insert_coach_or_above" ON public.songs;
CREATE POLICY "songs_insert_coach_or_above" ON public.songs
  FOR INSERT
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

DROP POLICY IF EXISTS "songs_update_coach_or_above" ON public.songs;
CREATE POLICY "songs_update_coach_or_above" ON public.songs
  FOR UPDATE
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])))
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

-- videos: assistant_coach+ INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "videos_delete_coach_or_above" ON public.videos;
CREATE POLICY "videos_delete_coach_or_above" ON public.videos
  FOR DELETE
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

DROP POLICY IF EXISTS "videos_insert_coach_or_above" ON public.videos;
CREATE POLICY "videos_insert_coach_or_above" ON public.videos
  FOR INSERT
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

DROP POLICY IF EXISTS "videos_update_coach_or_above" ON public.videos;
CREATE POLICY "videos_update_coach_or_above" ON public.videos
  FOR UPDATE
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])))
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

-- whiteboards: assistant_coach+ INSERT / UPDATE / DELETE
DROP POLICY IF EXISTS "wb_delete_own_org" ON public.whiteboards;
CREATE POLICY "wb_delete_own_org" ON public.whiteboards
  FOR DELETE
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

DROP POLICY IF EXISTS "wb_insert_own_org" ON public.whiteboards;
CREATE POLICY "wb_insert_own_org" ON public.whiteboards
  FOR INSERT
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

DROP POLICY IF EXISTS "wb_update_own_org" ON public.whiteboards;
CREATE POLICY "wb_update_own_org" ON public.whiteboards
  FOR UPDATE
  USING ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])))
  WITH CHECK ((org_id = get_my_org_id()) AND (get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])));

COMMIT;
