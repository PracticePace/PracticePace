-- Cross-program coach support, Commit E: make the program switcher actually
-- work (and stay safe) at the RLS layer.
--
-- PROBLEM
--   Commits A-D built current_org_id + coach_orgs but deliberately left
--   every content-table RLS policy (scripts, songs, videos, playlists,
--   playlist_songs, whiteboards, scoreboard_configs, backgrounds,
--   organizations, profiles, coach_orgs itself) reading get_my_org_id(),
--   which reads profiles.org_id. A non-AD coach switching current_org_id
--   to a second program would therefore see the switch reflected in the
--   UI, but every actual data query for that program would come back
--   empty — RLS still scopes them to their original org_id. (AD's
--   existing switcher was never affected by this, because AD has a
--   separate, independent account-wide RLS carve-out on every one of
--   these tables — see 20260519000000.)
--
--   Separately: profiles.current_org_id has had NO write validation since
--   it was added (Commit B) — the "users can update their own profile"
--   policy only checks row ownership (id = auth.uid()), not column
--   values. That was low-risk while current_org_id was purely
--   informational. It stops being low-risk the moment get_my_org_id()
--   reads it: without a guard, any authenticated coach could set their
--   own current_org_id to an arbitrary org's UUID (including one on a
--   completely different account) and gain that org's RLS-scoped access
--   to scripts/songs/videos/whiteboards/etc. — a real broken-access-
--   control bug, not a hypothetical one.
--
-- FIX
--   1. get_my_org_id() now reads current_org_id instead of org_id. Every
--      existing policy that calls it is automatically upgraded with zero
--      policy rewrites, since current_org_id is backfilled 1:1 from
--      org_id for every existing profile and kept valid going forward by
--      Commit C's login-repair + this migration's guard trigger.
--   2. A BEFORE INSERT OR UPDATE trigger on profiles rejects any write
--      that sets current_org_id to a value that isn't (a) NULL, or (b) an
--      org_id the profile actually has a coach_orgs row for. This runs
--      for every write path regardless of caller (including service-role
--      writes — triggers are not bypassed by RLS bypass), so it's a
--      DB-level guarantee, not just an application-layer convention.
--
-- profiles.org_id remains untouched and unused by this migration — it's
-- still the coach's permanent "home" org, just no longer what RLS checks.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  select current_org_id from profiles where id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.validate_profile_current_org_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.current_org_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.current_org_id IS DISTINCT FROM OLD.current_org_id)
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM coach_orgs
      WHERE profile_id = NEW.id AND org_id = NEW.current_org_id
    ) THEN
      RAISE EXCEPTION 'current_org_id % is not a coach_orgs membership for profile %', NEW.current_org_id, NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_current_org_id_guard ON public.profiles;
CREATE TRIGGER profiles_current_org_id_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_current_org_id();

COMMIT;
