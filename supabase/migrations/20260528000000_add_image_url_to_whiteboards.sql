-- Whiteboard image backgrounds (Commit 1): persist the URL of a coach-
-- uploaded image so it can serve as the underlay for the drawing canvas.
--
-- NULL                 → no custom image. Background dropdown options
--                        ('blank', sport courts) decide what's drawn.
-- non-NULL + background = 'custom_image' → the image is the active
--                        underlay; sport-court rendering is bypassed.
-- non-NULL + background ≠ 'custom_image' → image is stashed. Coach
--                        switched back to a sport court but can pick
--                        "Custom image" from the dropdown to restore.
--
-- Storage: re-uses the existing `backgrounds` bucket (already has
-- public-read + org-scoped write RLS from migration 20260517000000),
-- with files at  <org_id>/whiteboard-images/<timestamp>-<file>.  No
-- new bucket and no new storage.objects policy required — the existing
-- split_part(name, '/', 1) = caller_org_id gate covers it.
--
-- Existing whiteboards RLS already covers SELECT/INSERT/UPDATE/DELETE
-- for any member of the org (migration 20260510000000), so the new
-- column is automatically gated.
--
-- Apply manually via Supabase Dashboard → SQL Editor on the DATA
-- project (hkezhdcyrqariaocdody / Practice:Pace) if this didn't run via
-- MCP at migration time. Idempotent.

ALTER TABLE public.whiteboards
  ADD COLUMN IF NOT EXISTS image_url text;
