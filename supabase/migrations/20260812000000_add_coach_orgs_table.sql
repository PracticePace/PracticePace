-- Cross-program coach support, Commit A: schema + backfill only.
--
-- Adds public.coach_orgs — a junction table that will eventually let a
-- single coach profile belong to more than one org (program) within an
-- account. profiles.org_id / profiles.role stay in place as the current
-- source of truth for now; this commit only lays down the new table and
-- backfills it 1:1 from existing profiles rows. No app code reads or
-- writes coach_orgs yet.
--
-- RLS mirrors the account-wide AD carve-out pattern used everywhere else
-- (see 20260519000000_ad_account_wide_carve_out_on_content_tables.sql)
-- and the INSERT/UPDATE/DELETE structure profiles itself uses for role
-- edits (see 20260518000000_tighten_profile_update_delete_rls.sql),
-- translated from profiles.account_id to an organizations join since
-- coach_orgs only carries org_id.

BEGIN;

-- ── coach_orgs ──────────────────────────────────────────────────────────────

CREATE TABLE public.coach_orgs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, org_id)
);

-- Backfill: one row per existing profile with a non-null org_id.
INSERT INTO public.coach_orgs (profile_id, org_id, role)
SELECT id, org_id, role
FROM public.profiles
WHERE org_id IS NOT NULL;

CREATE INDEX idx_coach_orgs_profile_id ON public.coach_orgs(profile_id);
CREATE INDEX idx_coach_orgs_org_id     ON public.coach_orgs(org_id);

ALTER TABLE public.coach_orgs ENABLE ROW LEVEL SECURITY;

-- SELECT: a coach can see their own membership rows; an AD can see every
-- membership row for any org in their account (account-wide carve-out,
-- gated on role = 'ad' same as every other table with this pattern).
CREATE POLICY coach_orgs_select_own_or_ad ON public.coach_orgs
  FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (
      get_my_role() = 'ad'
      AND EXISTS (
        SELECT 1 FROM public.organizations
        WHERE organizations.id = coach_orgs.org_id
          AND organizations.account_id = get_my_account_id()
      )
    )
  );

-- INSERT / UPDATE / DELETE: mirrors "ad and head_coach can
-- insert/update/delete profiles" from 20260518000000 — AD is account-wide
-- (via the organizations join, since coach_orgs has no account_id column
-- of its own); head_coach is limited to their own org and cannot touch
-- rows whose role is (or, on UPDATE, would become) 'ad'.
CREATE POLICY coach_orgs_insert_ad_or_head_coach ON public.coach_orgs
  FOR INSERT
  WITH CHECK (
    (
      get_my_role() = 'ad'
      AND EXISTS (
        SELECT 1 FROM public.organizations
        WHERE organizations.id = coach_orgs.org_id
          AND organizations.account_id = get_my_account_id()
      )
    )
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  );

CREATE POLICY coach_orgs_update_ad_or_head_coach ON public.coach_orgs
  FOR UPDATE
  USING (
    (
      get_my_role() = 'ad'
      AND EXISTS (
        SELECT 1 FROM public.organizations
        WHERE organizations.id = coach_orgs.org_id
          AND organizations.account_id = get_my_account_id()
      )
    )
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  )
  WITH CHECK (
    (
      get_my_role() = 'ad'
      AND EXISTS (
        SELECT 1 FROM public.organizations
        WHERE organizations.id = coach_orgs.org_id
          AND organizations.account_id = get_my_account_id()
      )
    )
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  );

CREATE POLICY coach_orgs_delete_ad_or_head_coach ON public.coach_orgs
  FOR DELETE
  USING (
    (
      get_my_role() = 'ad'
      AND EXISTS (
        SELECT 1 FROM public.organizations
        WHERE organizations.id = coach_orgs.org_id
          AND organizations.account_id = get_my_account_id()
      )
    )
    OR (
      get_my_role() = 'head_coach'
      AND org_id = get_my_org_id()
      AND role <> 'ad'
    )
  );

COMMIT;
