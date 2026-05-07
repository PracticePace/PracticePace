-- Per-script toggle controlling whether the practice screen renders the
-- current drill's note as small secondary text under the drill name.
-- Defaults to false so all existing scripts behave identically.
--
-- Drill-level notes themselves are stored as a `notes` string field inside
-- each entry of the existing scripts.drills jsonb array — no schema change
-- needed for that. This column gates the per-script display preference.
--
-- Apply manually via Supabase Dashboard → SQL Editor — this repo is not
-- wired up for auto-migration. Already applied to the data project
-- (Aggie-Tempo / hkezhdcyrqariaocdody) via Supabase MCP.

ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS show_notes_on_practice boolean NOT NULL DEFAULT false;
