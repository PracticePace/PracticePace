-- Expand the allowed sport values for organizations.sport and scripts.sport
-- so the org sport selector in onboarding/settings can offer cheerleading and
-- the other common sports listed in src/lib/sports.js.
--
-- Adds:    cheerleading, cross country, dance, golf, gymnastics, hockey,
--          lacrosse, swimming, track and field
-- Removes: track  (no production rows used it; replaced by 'track and field')
--
-- Apply manually via Supabase Dashboard → SQL Editor — this repo is not
-- wired up for auto-migration.

ALTER TABLE public.organizations DROP CONSTRAINT organizations_sport_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_sport_check
  CHECK (sport IN (
    'baseball','basketball','cheerleading','cross country','dance',
    'football','golf','gymnastics','hockey','lacrosse','soccer',
    'softball','swimming','tennis','track and field','volleyball',
    'wrestling','other'
  ));

ALTER TABLE public.scripts DROP CONSTRAINT scripts_sport_check;
ALTER TABLE public.scripts ADD CONSTRAINT scripts_sport_check
  CHECK (sport IN (
    'baseball','basketball','cheerleading','cross country','dance',
    'football','golf','gymnastics','hockey','lacrosse','soccer',
    'softball','swimming','tennis','track and field','volleyball',
    'wrestling','other'
  ));
