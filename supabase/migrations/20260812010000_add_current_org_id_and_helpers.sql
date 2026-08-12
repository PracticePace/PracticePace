-- Cross-program coach support, Commit B: "current org" concept.
--
-- Adds profiles.current_org_id — the org a coach is actively viewing right
-- now. This is distinct from profiles.org_id, which stays in place as the
-- coach's "home" org (and remains the fallback everywhere until later
-- commits migrate reads over — see the app-code changes in this same
-- commit that switch application-layer scoping reads to current_org_id).
--
-- Also adds two helper functions used going forward in place of bare
-- profile.org_id reads:
--   • get_my_current_org_id() — mirrors get_my_org_id()'s shape, but reads
--     current_org_id instead. Intended to eventually replace get_my_org_id()
--     inside RLS policies, but per Commit B scope, existing RLS policies
--     are NOT rewritten in this migration — this just makes the function
--     available.
--   • get_my_orgs() — every org_id a coach belongs to, via coach_orgs.
--     Not consumed by anything yet; groundwork for the Commit E
--     program-switcher UI.
--
-- profiles.org_id and profiles.role are NOT modified or dropped here.

BEGIN;

-- ── profiles.current_org_id ─────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN current_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Backfill: single-program coaches (and everyone else, today) get
-- current_org_id = their existing org_id, so nothing changes for them.
UPDATE public.profiles
SET current_org_id = org_id
WHERE current_org_id IS NULL;

-- ── get_my_current_org_id() ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  select current_org_id from profiles where id = auth.uid();
$function$;

-- ── get_my_orgs() ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_orgs()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  select org_id from coach_orgs where profile_id = auth.uid();
$function$;

COMMIT;
