-- ─────────────────────────────────────────────────────────────────────────────
-- Practice screen background — adjustable dim/overlay
--
-- Until now the practice screen rendered a hardcoded rgba(0,0,0,0.72)
-- overlay on top of any uploaded background image. Coaches consistently
-- read that as "the image looks washed out" — 72% black is enough to
-- obliterate most of the image content. There was no setting to tune it.
--
-- This migration adds a per-org dim level so coaches can pick anywhere
-- from 0 (image as uploaded, the new default) to 100 (solid black).
-- Existing rows get the default 0 — a deliberate behavior change:
-- previously-uploaded backgrounds will now display brighter than they
-- did before. That matches the spec's intent ("honor the coach's image
-- as uploaded"); a coach who wants the old look can slide back to ~72.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS background_dim integer NOT NULL DEFAULT 0;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_background_dim_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_background_dim_check
  CHECK (background_dim BETWEEN 0 AND 100);
