-- P0 security fixes — RLS hardening before paying customers onboard.
-- See the multi-tenant isolation audit report (2026-05-15) for full
-- findings; this migration closes the database-side gaps. The matching
-- /api/invite-coach JWT-auth fix ships in the same commit but lives in
-- the Vercel edge function (not a DB migration).
--
-- Net effect:
--   • anon can no longer read pending coach_invites tokens.
--   • accounts INSERT requires an authenticated user with no existing
--     account row (no more "with_check: true for {public}" footgun).
--   • readonly role is actually enforced for writes on scripts, videos,
--     songs, whiteboards (was bypassed by duplicate ungated permissive
--     policies — Postgres OR's permissive policies so the broader one
--     always won).
--   • coach / readonly can no longer rename a program, change sport,
--     change colors, etc. (organizations UPDATE was shadowed the same
--     way; now role-gated to owner/admin only).
--
-- SCOPE NOTES (intentionally NOT in this migration):
--   • Cross-program isolation for profiles/organizations is still
--     account-level. Football admin can still touch Basketball-program
--     staff/settings at the same school. That's part of Commit 2 (the
--     role-model refactor); this migration only closes the role-gate
--     bypass, not the program-level scoping.
--   • The coach_invites table itself is dead code (live invite flow
--     uses auth.users.user_metadata). We're NOT dropping the table
--     here — just the public-read policy — in case a future invite
--     system wires it back in.
--
-- Apply manually via Supabase Dashboard → SQL Editor on the DATA
-- project (Aggie-Tempo / hkezhdcyrqariaocdody) — this repo is not
-- wired up for auto-migration. Also applied via Supabase MCP at
-- migration time; this file is the canonical record.

-- ── 1. coach_invites — kill the anon-readable invite-token leak ─────────────
-- The "public can read valid invites" policy let any unauthenticated
-- visitor SELECT every unexpired+unused invite, INCLUDING the token
-- column. Live invite flow doesn't use this table.
DROP POLICY IF EXISTS "public can read valid invites" ON public.coach_invites;

-- ── 2. accounts INSERT — kill the with_check: true footgun ──────────────────
-- New behaviour: must be authenticated, and the new row's id must not
-- already match an existing account_id on the caller's profile (i.e.
-- one account row per user). Closes the design hygiene risk flagged
-- in the audit even though no live exploit was reproduced.
DROP POLICY IF EXISTS "users can insert their own account" ON public.accounts;
CREATE POLICY "authenticated users can create their first account"
  ON public.accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND id NOT IN (SELECT account_id FROM public.profiles WHERE id = auth.uid())
  );

-- ── 3. scripts — drop the ungated duplicates that shadowed the role gate ────
-- Each kept the role-gated policy; dropped the ungated org-member
-- variant. SELECT had two redundant policies (both org-member, no role
-- gate); we keep one and drop the other for cleanliness.
DROP POLICY IF EXISTS "org members can delete scripts" ON public.scripts;
DROP POLICY IF EXISTS "org members can insert scripts" ON public.scripts;
DROP POLICY IF EXISTS "org members can update scripts" ON public.scripts;
DROP POLICY IF EXISTS "org members can select scripts" ON public.scripts;
-- Kept: "admins and above can delete scripts" (owner/admin only)
-- Kept: "coaches and above can insert scripts" (role IN owner/admin/coach)
-- Kept: "coaches and above can update scripts" (role IN owner/admin/coach)
-- Kept: "org members can view scripts" (any org member, no role check)

-- ── 4. videos — drop ALL existing policies, recreate split into per-CRUD ────
-- The previous "coaches and above can manage videos" was an ALL policy
-- with role IN (owner/admin/coach). If we kept just that + dropped the
-- broad SELECTs, readonly would lose READ access too. Split into:
--   • SELECT — any org member (readonly can read)
--   • INSERT/UPDATE/DELETE — role IN (owner/admin/coach)
DROP POLICY IF EXISTS "coaches and above can manage videos" ON public.videos;
DROP POLICY IF EXISTS "org members can delete videos"      ON public.videos;
DROP POLICY IF EXISTS "org members can insert videos"      ON public.videos;
DROP POLICY IF EXISTS "org members can select videos"      ON public.videos;
DROP POLICY IF EXISTS "org members can view videos"        ON public.videos;

CREATE POLICY "videos_select_org_members" ON public.videos
  FOR SELECT TO authenticated
  USING (org_id = get_my_org_id());

CREATE POLICY "videos_insert_coach_or_above" ON public.videos
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

CREATE POLICY "videos_update_coach_or_above" ON public.videos
  FOR UPDATE TO authenticated
  USING (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  )
  WITH CHECK (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

CREATE POLICY "videos_delete_coach_or_above" ON public.videos
  FOR DELETE TO authenticated
  USING (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

-- ── 5. songs — same split as videos ─────────────────────────────────────────
-- Previous policies had NO role check at all — every signed-in org
-- member could write (including readonly). Recreating with split
-- SELECT vs role-gated writes.
DROP POLICY IF EXISTS "coaches and above can manage songs" ON public.songs;
DROP POLICY IF EXISTS "org members can view songs"        ON public.songs;

CREATE POLICY "songs_select_org_members" ON public.songs
  FOR SELECT TO authenticated
  USING (org_id = get_my_org_id());

CREATE POLICY "songs_insert_coach_or_above" ON public.songs
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

CREATE POLICY "songs_update_coach_or_above" ON public.songs
  FOR UPDATE TO authenticated
  USING (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  )
  WITH CHECK (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

CREATE POLICY "songs_delete_coach_or_above" ON public.songs
  FOR DELETE TO authenticated
  USING (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

-- ── 6. whiteboards — keep SELECT, role-gate writes ──────────────────────────
-- Existing policies were org-member-only with no role check. Keep
-- wb_select_own_org untouched (any org member can see the board);
-- drop + recreate write policies with role gates.
DROP POLICY IF EXISTS "wb_insert_own_org" ON public.whiteboards;
DROP POLICY IF EXISTS "wb_update_own_org" ON public.whiteboards;
DROP POLICY IF EXISTS "wb_delete_own_org" ON public.whiteboards;

CREATE POLICY "wb_insert_own_org" ON public.whiteboards
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

CREATE POLICY "wb_update_own_org" ON public.whiteboards
  FOR UPDATE TO authenticated
  USING (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  )
  WITH CHECK (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

CREATE POLICY "wb_delete_own_org" ON public.whiteboards
  FOR DELETE TO authenticated
  USING (
    org_id = get_my_org_id()
    AND get_my_role() = ANY (ARRAY['owner','admin','coach'])
  );

-- ── 7. organizations — drop the ungated policies that shadowed the gate ─────
-- The kept policies require role IN (owner/admin) for write paths and
-- account-membership for read. Cross-program-same-account isolation is
-- NOT changed in this migration (still account-level) — that's a
-- separate concern for Commit 2.
DROP POLICY IF EXISTS "Authenticated users can create orgs" ON public.organizations;
DROP POLICY IF EXISTS "Org members can read their org"      ON public.organizations;
DROP POLICY IF EXISTS "Org admins can update their org"     ON public.organizations;
DROP POLICY IF EXISTS "Org members can update their org"    ON public.organizations;
-- Kept: "owners and admins can insert orgs" (role-gated)
-- Kept: "members can view orgs in their account" (account-member read)
-- Kept: "owners and admins can update orgs" (role-gated)
