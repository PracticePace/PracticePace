-- Replaces the script-level show_notes_on_practice toggle (introduced in
-- 20260507000000) with a per-drill `show_notes` boolean carried inside each
-- entry of scripts.drills (jsonb). Per-drill control is what coaches asked
-- for — they want to opt individual drills in/out, not flip the whole script
-- on or off.
--
-- The per-drill flag lives inside the existing JSONB array; missing /
-- undefined is treated as false by the UI. No data backfill required.
--
-- Apply manually via Supabase Dashboard → SQL Editor — this repo is not
-- wired up for auto-migration. Already applied to the data project
-- (Aggie-Tempo / hkezhdcyrqariaocdody) via Supabase MCP.

ALTER TABLE public.scripts DROP COLUMN IF EXISTS show_notes_on_practice;
