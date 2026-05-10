-- Whiteboards: one persistent canvas per program.
--
-- A single row per org keyed on org_id (NOT a list of saved boards) — the
-- MVP intentionally does NOT support saved/named plays, folders, or a
-- playbook library. The drawing persists until the coach manually clears it.
--
-- Schema choice (vs. adding columns to organizations):
--   The `strokes` payload can grow to 100 KB+ for complex drawings. Loading
--   that on every organizations fetch would slow common queries. A separate
--   table keeps the org row lean and gives the whiteboard its own RLS
--   surface.
--
-- Apply manually via Supabase Dashboard → SQL Editor on the DATA project
-- (Aggie-Tempo / hkezhdcyrqariaocdody). Also applied via Supabase MCP at
-- migration time — this file is the canonical record.

CREATE TABLE IF NOT EXISTS public.whiteboards (
  org_id     uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- jsonb array of stroke objects:
  --   [{ tool: 'pen'|'eraser', color: '#rgb', thickness: number,
  --      points: [{ x: number, y: number, pressure: number }] }, ...]
  -- Default empty array so a freshly-rendered whiteboard has nothing to draw.
  strokes    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'blank' | 'football' | 'basketball'. Sport-specific backgrounds are
  -- offered based on org.sport in the UI; column is the persisted choice.
  background text NOT NULL DEFAULT 'blank',
  -- Display dimensions at the time of the last save. Used to scale the
  -- stored stroke coordinates back into the current viewport on load so
  -- a drawing made on iPad portrait still reads correctly on the
  -- landscape jumbotron, and vice-versa.
  width      integer,
  height     integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whiteboards ENABLE ROW LEVEL SECURITY;

-- Read: any member of the org can see the whiteboard.
CREATE POLICY "wb_select_own_org" ON public.whiteboards
  FOR SELECT
  TO authenticated
  USING (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  );

-- Upsert: any member of the org can write the whiteboard. (No role gating in
-- this MVP — matches the current Scripts editor / practice timer model where
-- all signed-in coaches in an org can edit.)
CREATE POLICY "wb_insert_own_org" ON public.whiteboards
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "wb_update_own_org" ON public.whiteboards
  FOR UPDATE
  TO authenticated
  USING (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "wb_delete_own_org" ON public.whiteboards
  FOR DELETE
  TO authenticated
  USING (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  );

-- Touch updated_at on every modification so callers can detect remote
-- changes (and so we have a simple "last activity" signal for support).
CREATE OR REPLACE FUNCTION public.whiteboards_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whiteboards_set_updated_at ON public.whiteboards;
CREATE TRIGGER whiteboards_set_updated_at
  BEFORE UPDATE ON public.whiteboards
  FOR EACH ROW
  EXECUTE FUNCTION public.whiteboards_set_updated_at();
