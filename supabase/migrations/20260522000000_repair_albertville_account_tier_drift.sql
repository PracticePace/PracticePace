-- ─────────────────────────────────────────────────────────────────────────────
-- One-time data repair: Albertville Aggies (account_id 9ae446e9-...) is
-- carrying account_type='program' and plan_type='single_program' from
-- when it had a single Football program. Commit 2b's Add-Program flow
-- created Girls Basketball without updating the tier columns, so the
-- account now has 2 programs but its tier still reads single.
--
-- /api/add-program and /api/delete-program both get an auto-sync update
-- in the same commit, so this drift can't recur on those code paths.
-- This migration is purely the historical-data fix.
--
-- The UPDATE is guarded by the program-count subquery so it's
-- idempotent — running it again is a no-op if the org count has since
-- changed (e.g. someone deleted Girls Basketball and brought the
-- account back to a single program).
--
-- OTHER DRIFT (reported but NOT auto-repaired in this migration —
-- per spec the user wants to decide manually):
--   • TEST (37f88e6e-...) — 1 program, marked school-tier
--   • Whitesburg Christian Academy (426c5951-...) — 1 program,
--     marked school-tier (Patrick Harding may have intentionally
--     signed up for school tier expecting more programs)
--   • Two duplicate "Albertville Aggies" account rows (e523c60b,
--     3fdcdec5) with 0 programs each — orphan accounts likely from
--     early onboarding attempts. Worth a cleanup pass separately.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.accounts
   SET account_type = 'school',
       plan_type    = 'school'
 WHERE id = '9ae446e9-f339-477b-ae04-75c79219bf12'
   AND (SELECT COUNT(*) FROM public.organizations
         WHERE account_id = '9ae446e9-f339-477b-ae04-75c79219bf12') >= 2;

COMMIT;
