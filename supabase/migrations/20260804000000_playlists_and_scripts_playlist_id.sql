-- Playlists Commit A: DB schema for named playlists.
--
-- Adds:
--   • public.playlists          — coach-created named playlists (org-scoped)
--   • public.playlist_songs     — junction table mapping songs to playlists
--                                 (denormalized org_id for direct RLS —
--                                 matches how songs/whiteboards/etc. are
--                                 filtered elsewhere in this repo)
--   • public.scripts.playlist_id  — nullable FK letting a script auto-load
--                                 a playlist on practice start (wired up
--                                 in Commits C/D). ON DELETE SET NULL so
--                                 deleting a playlist never cascades to
--                                 scripts — the assignment just clears.
--
-- RLS policies mirror the songs table (see
--   20260517000000_program_scoped_isolation_and_storage.sql and
--   20260519000000_ad_account_wide_carve_out_on_content_tables.sql):
--   SELECT open to org members + AD account-wide carve-out; INSERT /
--   UPDATE / DELETE additionally gated on coach-or-above role.

BEGIN;

-- ── playlists ────────────────────────────────────────────────────────────────

CREATE TABLE public.playlists (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_playlists_org_id ON public.playlists(org_id);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY playlists_select_org_members ON public.playlists
  FOR SELECT
  USING (
    (org_id = get_my_org_id())
    OR ((get_my_role() = 'ad') AND (org_id IN (
          SELECT organizations.id FROM organizations
          WHERE organizations.account_id = get_my_account_id())))
  );

CREATE POLICY playlists_insert_coach_or_above ON public.playlists
  FOR INSERT
  WITH CHECK (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  );

CREATE POLICY playlists_update_coach_or_above ON public.playlists
  FOR UPDATE
  USING (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  )
  WITH CHECK (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  );

CREATE POLICY playlists_delete_coach_or_above ON public.playlists
  FOR DELETE
  USING (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  );

-- ── playlist_songs (junction) ────────────────────────────────────────────────
-- org_id is denormalized so RLS can filter directly (matches songs et al.).
-- UNIQUE(playlist_id, song_id) prevents a song from being added twice to the
-- same playlist. position keeps user-facing ordering per playlist.

CREATE TABLE public.playlist_songs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  song_id     UUID NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, song_id)
);

CREATE INDEX idx_playlist_songs_playlist_id ON public.playlist_songs(playlist_id);
CREATE INDEX idx_playlist_songs_song_id     ON public.playlist_songs(song_id);
CREATE INDEX idx_playlist_songs_org_id      ON public.playlist_songs(org_id);

ALTER TABLE public.playlist_songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY playlist_songs_select_org_members ON public.playlist_songs
  FOR SELECT
  USING (
    (org_id = get_my_org_id())
    OR ((get_my_role() = 'ad') AND (org_id IN (
          SELECT organizations.id FROM organizations
          WHERE organizations.account_id = get_my_account_id())))
  );

CREATE POLICY playlist_songs_insert_coach_or_above ON public.playlist_songs
  FOR INSERT
  WITH CHECK (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  );

CREATE POLICY playlist_songs_update_coach_or_above ON public.playlist_songs
  FOR UPDATE
  USING (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  )
  WITH CHECK (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  );

CREATE POLICY playlist_songs_delete_coach_or_above ON public.playlist_songs
  FOR DELETE
  USING (
    (((org_id = get_my_org_id())
      OR ((get_my_role() = 'ad') AND (org_id IN (
            SELECT organizations.id FROM organizations
            WHERE organizations.account_id = get_my_account_id())))))
    AND (get_my_role() = ANY (ARRAY['ad', 'head_coach', 'assistant_coach']))
  );

-- ── scripts.playlist_id ──────────────────────────────────────────────────────
-- Nullable so back-compat is preserved: existing scripts with no assigned
-- playlist behave exactly as today (no music auto-loads on practice start).
-- ON DELETE SET NULL so playlist deletion clears the assignment without
-- disrupting the script itself.

ALTER TABLE public.scripts
  ADD COLUMN playlist_id UUID NULL
  REFERENCES public.playlists(id) ON DELETE SET NULL;

COMMIT;
