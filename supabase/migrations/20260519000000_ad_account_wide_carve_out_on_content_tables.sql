-- ─────────────────────────────────────────────────────────────────────────────
-- AD account-wide carve-out on every org-scoped content table.
--
-- WHY
--   When Commit 2b shipped the program switcher, the AD can switch their
--   active program context to any sibling org in their account. The
--   frontend already passes the switched org_id to every section
--   (Scripts/Music/Whiteboard/Scoreboard/Settings via Dashboard's
--   activeOrgId). But the RLS policies on the content tables still
--   evaluate `org_id = get_my_org_id()` — which always returns the AD's
--   PINNED profile.org_id, not the active context. So:
--     • AD switches to Girls Basketball.
--     • Scripts tab queries scripts WHERE org_id = Girls_Basketball.
--     • RLS clamps that to org_id = get_my_org_id() = Football.
--     • Net effect: zero rows returned, looks empty/broken.
--   Same story for INSERT (AD can't create scripts in the switched
--   program), UPDATE, DELETE.
--
-- FIX PATTERN (applied to every org-scoped content table)
--   Wrap the existing org-check in an OR with an AD-only branch:
--
--     (org_id = get_my_org_id())                                  ← unchanged
--     OR (                                                         ← new
--       get_my_role() = 'ad'
--       AND org_id IN (
--         SELECT id FROM public.organizations
--          WHERE account_id = get_my_account_id()
--       )
--     )
--
--   The `get_my_role() = 'ad'` guard short-circuits the carve-out for
--   non-AD viewers (head_coach / assistant_coach / team_manager), so
--   cross-program isolation for non-ADs is unchanged. Cross-account
--   isolation is preserved because the inner subquery filters
--   organizations by the caller's own account_id.
--
--   Role-list guards inside each policy (role IN (ad,head_coach) for
--   admin-tier ops, role IN (ad,head_coach,assistant_coach) for coach-
--   tier ops) are preserved as-is.
--
-- TABLES TOUCHED (6 tables × ~4 policies each = 22 policy rewrites)
--   scripts:              SELECT + INSERT + UPDATE + DELETE
--   songs:                SELECT + INSERT + UPDATE + DELETE
--   videos:               SELECT + INSERT + UPDATE + DELETE
--   whiteboards:          SELECT + INSERT + UPDATE + DELETE
--   scoreboard_configs:   SELECT + ALL (covers I/U/D)
--   backgrounds:          SELECT + ALL (covers I/U/D)
--
-- WHAT IS NOT CHANGED
--   • profiles RLS, organizations RLS, accounts RLS, storage.objects RLS.
--     Those have their own AD account-wide gates already from earlier
--     migrations (20260517000000 + 20260517010000 + 20260518000000).
--   • get_my_role() / get_my_org_id() / get_my_account_id() helpers.
--   • Policy names — preserved so grepping the codebase still finds
--     them.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ============================================================================
-- scripts
-- ============================================================================

-- SELECT (was inline subquery — rewrite to use get_my_org_id for consistency)
DROP POLICY IF EXISTS "org members can view scripts" ON public.scripts;
CREATE POLICY "org members can view scripts" ON public.scripts
  FOR SELECT
  USING (
    org_id = get_my_org_id()
    OR (
      get_my_role() = 'ad'
      AND org_id IN (
        SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
      )
    )
  );

-- INSERT (was inline subquery for both org and role — rewrite for consistency)
DROP POLICY IF EXISTS "coaches and above can insert scripts" ON public.scripts;
CREATE POLICY "coaches and above can insert scripts" ON public.scripts
  FOR INSERT
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

-- UPDATE
DROP POLICY IF EXISTS "coaches and above can update scripts" ON public.scripts;
CREATE POLICY "coaches and above can update scripts" ON public.scripts
  FOR UPDATE
  USING (
    org_id = get_my_org_id()
    OR (
      get_my_role() = 'ad'
      AND org_id IN (
        SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
      )
    )
  )
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

-- DELETE
DROP POLICY IF EXISTS "admins and above can delete scripts" ON public.scripts;
CREATE POLICY "admins and above can delete scripts" ON public.scripts
  FOR DELETE
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])
  );

-- ============================================================================
-- songs
-- ============================================================================

DROP POLICY IF EXISTS "songs_select_org_members" ON public.songs;
CREATE POLICY "songs_select_org_members" ON public.songs
  FOR SELECT
  USING (
    org_id = get_my_org_id()
    OR (
      get_my_role() = 'ad'
      AND org_id IN (
        SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
      )
    )
  );

DROP POLICY IF EXISTS "songs_insert_coach_or_above" ON public.songs;
CREATE POLICY "songs_insert_coach_or_above" ON public.songs
  FOR INSERT
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

DROP POLICY IF EXISTS "songs_update_coach_or_above" ON public.songs;
CREATE POLICY "songs_update_coach_or_above" ON public.songs
  FOR UPDATE
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  )
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

DROP POLICY IF EXISTS "songs_delete_coach_or_above" ON public.songs;
CREATE POLICY "songs_delete_coach_or_above" ON public.songs
  FOR DELETE
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

-- ============================================================================
-- videos
-- ============================================================================

DROP POLICY IF EXISTS "videos_select_org_members" ON public.videos;
CREATE POLICY "videos_select_org_members" ON public.videos
  FOR SELECT
  USING (
    org_id = get_my_org_id()
    OR (
      get_my_role() = 'ad'
      AND org_id IN (
        SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
      )
    )
  );

DROP POLICY IF EXISTS "videos_insert_coach_or_above" ON public.videos;
CREATE POLICY "videos_insert_coach_or_above" ON public.videos
  FOR INSERT
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

DROP POLICY IF EXISTS "videos_update_coach_or_above" ON public.videos;
CREATE POLICY "videos_update_coach_or_above" ON public.videos
  FOR UPDATE
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  )
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

DROP POLICY IF EXISTS "videos_delete_coach_or_above" ON public.videos;
CREATE POLICY "videos_delete_coach_or_above" ON public.videos
  FOR DELETE
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

-- ============================================================================
-- whiteboards
-- ============================================================================

DROP POLICY IF EXISTS "wb_select_own_org" ON public.whiteboards;
CREATE POLICY "wb_select_own_org" ON public.whiteboards
  FOR SELECT
  USING (
    org_id = get_my_org_id()
    OR (
      get_my_role() = 'ad'
      AND org_id IN (
        SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
      )
    )
  );

DROP POLICY IF EXISTS "wb_insert_own_org" ON public.whiteboards;
CREATE POLICY "wb_insert_own_org" ON public.whiteboards
  FOR INSERT
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

DROP POLICY IF EXISTS "wb_update_own_org" ON public.whiteboards;
CREATE POLICY "wb_update_own_org" ON public.whiteboards
  FOR UPDATE
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  )
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

DROP POLICY IF EXISTS "wb_delete_own_org" ON public.whiteboards;
CREATE POLICY "wb_delete_own_org" ON public.whiteboards
  FOR DELETE
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

-- ============================================================================
-- scoreboard_configs
-- ============================================================================

DROP POLICY IF EXISTS "org members can view scoreboard configs" ON public.scoreboard_configs;
CREATE POLICY "org members can view scoreboard configs" ON public.scoreboard_configs
  FOR SELECT
  USING (
    org_id = get_my_org_id()
    OR (
      get_my_role() = 'ad'
      AND org_id IN (
        SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
      )
    )
  );

DROP POLICY IF EXISTS "coaches and above can manage scoreboard configs" ON public.scoreboard_configs;
CREATE POLICY "coaches and above can manage scoreboard configs" ON public.scoreboard_configs
  FOR ALL
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  )
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text, 'assistant_coach'::text])
  );

-- ============================================================================
-- backgrounds
-- ============================================================================

DROP POLICY IF EXISTS "org members can view backgrounds" ON public.backgrounds;
CREATE POLICY "org members can view backgrounds" ON public.backgrounds
  FOR SELECT
  USING (
    org_id = get_my_org_id()
    OR (
      get_my_role() = 'ad'
      AND org_id IN (
        SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
      )
    )
  );

DROP POLICY IF EXISTS "admins and above can manage backgrounds" ON public.backgrounds;
CREATE POLICY "admins and above can manage backgrounds" ON public.backgrounds
  FOR ALL
  USING (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])
  )
  WITH CHECK (
    (
      org_id = get_my_org_id()
      OR (
        get_my_role() = 'ad'
        AND org_id IN (
          SELECT id FROM public.organizations WHERE account_id = get_my_account_id()
        )
      )
    )
    AND get_my_role() = ANY (ARRAY['ad'::text, 'head_coach'::text])
  );

COMMIT;
