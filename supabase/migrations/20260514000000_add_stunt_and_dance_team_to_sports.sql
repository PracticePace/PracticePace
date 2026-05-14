-- Add 'stunt' and 'dance team' to the allowed sport values for both
-- organizations.sport and scripts.sport. Cheerleading was already in
-- the constraint (added in 20260506000001); this expansion picks up
-- the two adjacent disciplines that often share a coaching staff with
-- cheer programs.
--
-- Both new values match the canonical lowercase entries added to
-- src/lib/sports.js in the same commit. No data backfill required
-- — existing rows are untouched.
--
-- Apply manually via Supabase Dashboard → SQL Editor — this repo is
-- not wired up for auto-migration. Also applied via Supabase MCP at
-- migration time; this file is the canonical record.

ALTER TABLE public.organizations DROP CONSTRAINT organizations_sport_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_sport_check
  CHECK (sport IN (
    'baseball','basketball','cheerleading','cross country','dance',
    'dance team','football','golf','gymnastics','hockey','lacrosse',
    'soccer','softball','stunt','swimming','tennis','track and field',
    'volleyball','wrestling','other'
  ));

ALTER TABLE public.scripts DROP CONSTRAINT scripts_sport_check;
ALTER TABLE public.scripts ADD CONSTRAINT scripts_sport_check
  CHECK (sport IN (
    'baseball','basketball','cheerleading','cross country','dance',
    'dance team','football','golf','gymnastics','hockey','lacrosse',
    'soccer','softball','stunt','swimming','tennis','track and field',
    'volleyball','wrestling','other'
  ));
