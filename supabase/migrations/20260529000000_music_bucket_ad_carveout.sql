-- Music storage bucket: add AD account-wide carve-out for
-- INSERT / UPDATE / DELETE so an Athletic Director can manage music
-- files across every program in their account.
--
-- Parallel to the same carve-outs already applied to:
--   • backgrounds bucket   (migration 20260517000000)
--   • whiteboard-images    (migration 20260528010000)
-- The music bucket never got this update — a latent bug that surfaced
-- when an AD tried to upload an MP3 into a sibling program under
-- their account and hit "new row violates row-level security policy".
--
-- ADDITIVE: the three existing "Authenticated users can
-- upload/update/delete music to own org" policies are unchanged.
-- Postgres RLS combines permissive policies with OR — a caller passes
-- if ANY policy grants access. So org members keep the ability to
-- manage music files under their own org's path prefix; ADs also gain
-- the ability to manage music under any sibling org's path prefix
-- (as long as that org shares an account_id with them).
--
-- Apply manually via Supabase Dashboard → SQL Editor on the DATA
-- project (Practice:Pace / hkezhdcyrqariaocdody) if this didn't run
-- via MCP at migration time. Idempotent (DROP IF EXISTS on each
-- policy before CREATE).

DROP POLICY IF EXISTS "AD can upload music across account" ON storage.objects;
CREATE POLICY "AD can upload music across account"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'music'
    AND (
      SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid()
    ) = 'ad'
    AND split_part(name, '/'::text, 1) IN (
      SELECT (organizations.id)::text
      FROM public.organizations
      WHERE organizations.account_id = (
        SELECT profiles.account_id FROM public.profiles WHERE profiles.id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "AD can update music across account" ON storage.objects;
CREATE POLICY "AD can update music across account"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'music'
    AND (
      SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid()
    ) = 'ad'
    AND split_part(name, '/'::text, 1) IN (
      SELECT (organizations.id)::text
      FROM public.organizations
      WHERE organizations.account_id = (
        SELECT profiles.account_id FROM public.profiles WHERE profiles.id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "AD can delete music across account" ON storage.objects;
CREATE POLICY "AD can delete music across account"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'music'
    AND (
      SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid()
    ) = 'ad'
    AND split_part(name, '/'::text, 1) IN (
      SELECT (organizations.id)::text
      FROM public.organizations
      WHERE organizations.account_id = (
        SELECT profiles.account_id FROM public.profiles WHERE profiles.id = auth.uid()
      )
    )
  );
