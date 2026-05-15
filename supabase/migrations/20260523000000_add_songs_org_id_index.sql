-- ─────────────────────────────────────────────────────────────────────────────
-- Add the missing index on songs.org_id.
--
-- Every other org-scoped content table (scripts, videos, whiteboards,
-- scoreboard_configs, backgrounds) has a `*_org_id_idx`. songs was the
-- odd one out — every RLS-gated read on the table did a sequential
-- scan, harmless at 40 rows but linear with music-library size.
-- Flagged by the post-role-refactor audit (DB integrity §10).
--
-- IF NOT EXISTS so the migration is idempotent against any environment
-- where this was already added manually.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS songs_org_id_idx ON public.songs (org_id);
