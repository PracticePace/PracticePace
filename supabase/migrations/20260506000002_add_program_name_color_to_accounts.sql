-- Per-account custom color for the program name shown at the top of the
-- dashboard header. Nullable; the UI defaults to white (#ffffff) when not set.
--
-- Column lives on accounts (not organizations) because the Settings page
-- reads / writes color preferences alongside the rest of the subscription
-- row in the same save flow. Existing primary_color and secondary_color
-- still live on organizations.
--
-- Apply manually via Supabase Dashboard → SQL Editor — this repo is not
-- wired up for auto-migration.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS program_name_color TEXT;
