-- Whiteboard image library (Commit 2):
--   • New dedicated Supabase Storage bucket "whiteboard-images" so coach-
--     uploaded play diagrams / formation charts / photos no longer share
--     the practice-screen "backgrounds" bucket.
--   • New table public.whiteboard_images — per-program "bin" of named,
--     reusable images. The active image on a whiteboard is still
--     persisted on public.whiteboards.image_url (column added in
--     migration 20260528000000); this table provides the list of all
--     images the coach has saved for their program so they can switch
--     between them without re-uploading.
--
-- Storage path convention: <org_id>/<timestamp>.<ext>. The org_id MUST
-- be the first path segment so the org-scoped write policies below can
-- gate on split_part(name, '/', 1) — the same pattern the existing
-- backgrounds bucket uses (migration 20260517000000).
--
-- RLS model (mirrors content tables in 20260519000000):
--   • SELECT: any signed-in member of the org sees their org's rows;
--     AD also sees rows for every org in their account.
--   • INSERT/DELETE: head_coach + assistant_coach + ad on their own
--     org; AD across the account. team_manager is read-only (so the
--     library is browsable for them but the upload + delete controls
--     are gated client-side AND server-side).
--   • UPDATE not exposed in this commit (no rename UI in Commit 2;
--     coach can re-upload to change). Add later if needed.
--
-- Apply manually via Supabase Dashboard → SQL Editor on the DATA
-- project (hkezhdcyrqariaocdody / Practice:Pace) if this didn't run
-- via MCP at migration time. Idempotent (everything uses IF NOT
-- EXISTS / ON CONFLICT or DROP-then-CREATE for policies).

-- ── 1. Dedicated storage bucket ──────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('whiteboard-images', 'whiteboard-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public-read mirrors the backgrounds bucket so the <img>/canvas-side
-- code doesn't need signed URLs.
DROP POLICY IF EXISTS "Public can read whiteboard-images" ON storage.objects;
CREATE POLICY "Public can read whiteboard-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'whiteboard-images');

DROP POLICY IF EXISTS "Editors can upload whiteboard-images to own org" ON storage.objects;
CREATE POLICY "Editors can upload whiteboard-images to own org"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'whiteboard-images'
    AND (
      split_part(name, '/'::text, 1) = (
        SELECT (profiles.org_id)::text
        FROM public.profiles
        WHERE profiles.id = auth.uid()
      )
      OR (
        (
          SELECT profiles.role
          FROM public.profiles
          WHERE profiles.id = auth.uid()
        ) = 'ad'::text
        AND split_part(name, '/'::text, 1) IN (
          SELECT (organizations.id)::text
          FROM public.organizations
          WHERE organizations.account_id = (
            SELECT profiles.account_id
            FROM public.profiles
            WHERE profiles.id = auth.uid()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "Editors can update own org whiteboard-images" ON storage.objects;
CREATE POLICY "Editors can update own org whiteboard-images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'whiteboard-images'
    AND (
      split_part(name, '/'::text, 1) = (
        SELECT (profiles.org_id)::text
        FROM public.profiles
        WHERE profiles.id = auth.uid()
      )
      OR (
        (
          SELECT profiles.role
          FROM public.profiles
          WHERE profiles.id = auth.uid()
        ) = 'ad'::text
        AND split_part(name, '/'::text, 1) IN (
          SELECT (organizations.id)::text
          FROM public.organizations
          WHERE organizations.account_id = (
            SELECT profiles.account_id
            FROM public.profiles
            WHERE profiles.id = auth.uid()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "Editors can delete own org whiteboard-images" ON storage.objects;
CREATE POLICY "Editors can delete own org whiteboard-images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'whiteboard-images'
    AND (
      split_part(name, '/'::text, 1) = (
        SELECT (profiles.org_id)::text
        FROM public.profiles
        WHERE profiles.id = auth.uid()
      )
      OR (
        (
          SELECT profiles.role
          FROM public.profiles
          WHERE profiles.id = auth.uid()
        ) = 'ad'::text
        AND split_part(name, '/'::text, 1) IN (
          SELECT (organizations.id)::text
          FROM public.organizations
          WHERE organizations.account_id = (
            SELECT profiles.account_id
            FROM public.profiles
            WHERE profiles.id = auth.uid()
          )
        )
      )
    )
  );

-- ── 2. Library table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whiteboard_images (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  image_url    text        NOT NULL,            -- public Storage URL (incl. cache-buster)
  storage_path text        NOT NULL,            -- bucket path "<org_id>/<file>"; used for storage.remove()
  name         text        NOT NULL,            -- coach's label, defaults from file name
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whiteboard_images_org_id_created_at_idx
  ON public.whiteboard_images (org_id, created_at DESC);

ALTER TABLE public.whiteboard_images ENABLE ROW LEVEL SECURITY;

-- SELECT: org members + AD account-wide carve-out.
DROP POLICY IF EXISTS "wbimg_select_org_scope" ON public.whiteboard_images;
CREATE POLICY "wbimg_select_org_scope"
  ON public.whiteboard_images FOR SELECT
  TO authenticated
  USING (
    org_id = (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
    OR (
      (SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid()) = 'ad'
      AND org_id IN (
        SELECT organizations.id FROM public.organizations
        WHERE organizations.account_id = (
          SELECT profiles.account_id FROM public.profiles WHERE profiles.id = auth.uid()
        )
      )
    )
  );

-- INSERT: head_coach / assistant_coach / ad on their own org; AD across account.
DROP POLICY IF EXISTS "wbimg_insert_editors" ON public.whiteboard_images;
CREATE POLICY "wbimg_insert_editors"
  ON public.whiteboard_images FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      (SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid())
        IN ('head_coach','assistant_coach','ad')
      AND org_id = (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
    )
    OR (
      (SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid()) = 'ad'
      AND org_id IN (
        SELECT organizations.id FROM public.organizations
        WHERE organizations.account_id = (
          SELECT profiles.account_id FROM public.profiles WHERE profiles.id = auth.uid()
        )
      )
    )
  );

-- DELETE: same scope as INSERT — team_manager cannot delete.
DROP POLICY IF EXISTS "wbimg_delete_editors" ON public.whiteboard_images;
CREATE POLICY "wbimg_delete_editors"
  ON public.whiteboard_images FOR DELETE
  TO authenticated
  USING (
    (
      (SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid())
        IN ('head_coach','assistant_coach','ad')
      AND org_id = (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid())
    )
    OR (
      (SELECT profiles.role FROM public.profiles WHERE profiles.id = auth.uid()) = 'ad'
      AND org_id IN (
        SELECT organizations.id FROM public.organizations
        WHERE organizations.account_id = (
          SELECT profiles.account_id FROM public.profiles WHERE profiles.id = auth.uid()
        )
      )
    )
  );
