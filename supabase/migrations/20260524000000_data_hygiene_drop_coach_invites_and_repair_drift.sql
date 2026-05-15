-- ─────────────────────────────────────────────────────────────────────────────
-- Data hygiene — two unrelated cleanups in one migration.
--
-- 1) Drop public.coach_invites
--    Audit flagged this table as dead. The live invite flow uses
--    Supabase auth's built-in invite mechanism + /api/invite-coach +
--    /api/accept-invite. None of those touch coach_invites. The only
--    code-side reference is a stale doc comment in api/delete-program.js
--    that lists the table in the FK CASCADE chain (updated separately
--    in this commit). The table holds one expired test invite row
--    (Quinton Williams, expired 2026-05-03). No inbound FKs reference
--    the table. CASCADE on the DROP removes the table's RLS policy
--    ("admins can manage invites" — pre-P0 loose policy with no role
--    guard, still using the legacy "admins" term) and the PK index.
--
-- 2) Repair drift accounts where account_type / plan_type don't match
--    the invariant the /api/add-program + /api/delete-program auto-sync
--    enforces:
--       1 program   → account_type='program' / plan_type='single_program'
--       2+ programs → account_type='school'  / plan_type='school'
--    Two accounts drifted before the auto-sync wiring shipped:
--       • TEST (37f88e6e-...) — 1 program, marked school/school
--       • Whitesburg Christian Academy (426c5951-...) — same
--    The repair flips them back. Each UPDATE is guarded by an exact
--    id match AND a row-count assertion in a DO block — any unexpected
--    count aborts the entire transaction.
--
--    NOT REPAIRED (flagged for separate decision):
--       • Two orphan "Albertville Aggies" account rows (e523c60b...,
--         3fdcdec5...) with 0 programs each. 0 programs isn't a
--         defined tier under the invariant; spec says don't touch.
--    NOT IN SCOPE:
--       • PracticePace Demo (ed50286a-...) — auto-sync correctly
--         promoted it to school/school during today's 1→3 adds; OK.
--       • Albertville Aggies (9ae446e9-...) — already repaired in
--         migration 20260522000000.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1) Drop coach_invites ────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.coach_invites CASCADE;

-- ── 2) Repair drift accounts with row-count guards ───────────────────────────
DO $$
DECLARE
  v_test_aid       uuid := '37f88e6e-ca17-4a21-81b4-27eaa5f746bd';
  v_whitesburg_aid uuid := '426c5951-872e-4491-8995-f3076f1a97ca';
  v_n int;
BEGIN
  -- TEST account — 1 program, currently school/school
  UPDATE public.accounts
     SET account_type = 'program',
         plan_type    = 'single_program'
   WHERE id           = v_test_aid
     AND account_type = 'school'
     AND plan_type    = 'school'
     AND (SELECT COUNT(*) FROM public.organizations
           WHERE account_id = v_test_aid) = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST account drift repair: expected 1 row, got %', v_n;
  END IF;

  -- Whitesburg Christian Academy — 1 program, currently school/school
  UPDATE public.accounts
     SET account_type = 'program',
         plan_type    = 'single_program'
   WHERE id           = v_whitesburg_aid
     AND account_type = 'school'
     AND plan_type    = 'school'
     AND (SELECT COUNT(*) FROM public.organizations
           WHERE account_id = v_whitesburg_aid) = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Whitesburg account drift repair: expected 1 row, got %', v_n;
  END IF;

  RAISE NOTICE 'OK: drift repaired on 2 accounts (TEST + Whitesburg Christian Academy)';
END $$;

COMMIT;
