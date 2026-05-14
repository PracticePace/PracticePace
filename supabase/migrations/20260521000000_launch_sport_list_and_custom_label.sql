-- ─────────────────────────────────────────────────────────────────────────────
-- Sport list refresh for launch + Custom-label support.
--
-- WHY
--   The pre-launch sport list was alphabetical, included sports the
--   product doesn't actively target (golf, swimming, wrestling, …), and
--   bundled boys/girls basketball under a single "basketball" value.
--   Launch list shrinks to the sports we know are running and adds a
--   "Custom" option for the long tail (a coach types their own label —
--   "8-Man Football", "Esports", "Cheerleading Stunt Team", whatever).
--
-- LAUNCH LIST (canonical lowercase snake_case → Title-Case display)
--   football            → Football
--   flag_football       → Flag Football
--   boys_basketball     → Boys Basketball
--   girls_basketball    → Girls Basketball
--   cheerleading        → Cheerleading
--   boys_soccer         → Boys Soccer
--   girls_soccer        → Girls Soccer
--   volleyball          → Volleyball
--   baseball            → Baseball
--   softball            → Softball
--   custom              → Custom    (always last in the dropdown; pairs
--                                    with sport_custom_label text input)
--
-- CHECK CONSTRAINTS
--   organizations_sport_check + scripts_sport_check both currently
--   permit the legacy 20-sport list. We rewrite both to allow:
--     • the 11 launch values above
--     • a grandfather set for legacy rows so we don't have to migrate
--       existing data (the spec is explicit: leave existing programs
--       as-is, just flag them).
--   The grandfather set covers every value that exists in the live DB
--   today (basketball, cheerleading, football already covered) plus the
--   broader pre-launch set the old constraint allowed, in case
--   scripts.sport rows lived on values the orgs table doesn't.
--
-- CUSTOM LABEL COLUMN
--   New column public.organizations.sport_custom_label TEXT NULL.
--   Convention:
--     • sport = 'custom'  →  sport_custom_label SHOULD be non-null and
--                            display "Custom — <label>" in the UI.
--                            (We don't enforce non-null at the DB layer
--                            because mid-onboarding a row may exist with
--                            sport='custom' and label still pending; UI
--                            does the right thing in either state.)
--     • sport != 'custom' →  sport_custom_label SHOULD be NULL. The UI
--                            clears the column when a user switches
--                            away from Custom in Settings.
--   No equivalent column on scripts.sport — scripts inherit context
--   from their program, and a 'custom' script just means "this is for
--   a custom-sport program"; the org's sport_custom_label is the
--   authoritative display string for that program's content.
--
-- EXISTING DATA NOT AUTO-MIGRATED (per spec, report only):
--   organizations.sport='basketball'  (3 rows: Alabama Crimson Tide
--     Basketball, Girls Basketball, Whitesburg Warriors Basketball).
--     They'll continue to work because 'basketball' is in the
--     grandfather list, but a coach will see "basketball" in the
--     dropdown without it matching any launch-list option until they
--     re-pick (Boys Basketball or Girls Basketball).
--   organizations.sport='football'   (1 row, valid in new list, ✓)
--   organizations.sport='cheerleading' (1 row, valid in new list, ✓)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. New custom-label column on organizations.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sport_custom_label TEXT;

-- 2. Rewrite organizations_sport_check
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_sport_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_sport_check
  CHECK (sport = ANY (ARRAY[
    -- ── Launch list ─────────────────────────────────────────────────
    'football'::text,
    'flag_football'::text,
    'boys_basketball'::text,
    'girls_basketball'::text,
    'cheerleading'::text,
    'boys_soccer'::text,
    'girls_soccer'::text,
    'volleyball'::text,
    'baseball'::text,
    'softball'::text,
    'custom'::text,
    -- ── Grandfathered legacy values (existing rows + pre-launch
    --     constraint values we won't surface in the UI anymore but
    --     don't want to invalidate either). ────────────────────────
    'basketball'::text,
    'soccer'::text,
    'stunt'::text,
    'dance'::text,
    'dance team'::text,
    'cross country'::text,
    'golf'::text,
    'gymnastics'::text,
    'hockey'::text,
    'lacrosse'::text,
    'swimming'::text,
    'tennis'::text,
    'track and field'::text,
    'wrestling'::text,
    'other'::text
  ]));

-- 3. Same shape for scripts_sport_check. Scripts inherit sport from
--    their program, so the same set is the right set.
ALTER TABLE public.scripts
  DROP CONSTRAINT IF EXISTS scripts_sport_check;
ALTER TABLE public.scripts
  ADD CONSTRAINT scripts_sport_check
  CHECK (sport = ANY (ARRAY[
    'football'::text,
    'flag_football'::text,
    'boys_basketball'::text,
    'girls_basketball'::text,
    'cheerleading'::text,
    'boys_soccer'::text,
    'girls_soccer'::text,
    'volleyball'::text,
    'baseball'::text,
    'softball'::text,
    'custom'::text,
    'basketball'::text,
    'soccer'::text,
    'stunt'::text,
    'dance'::text,
    'dance team'::text,
    'cross country'::text,
    'golf'::text,
    'gymnastics'::text,
    'hockey'::text,
    'lacrosse'::text,
    'swimming'::text,
    'tennis'::text,
    'track and field'::text,
    'wrestling'::text,
    'other'::text
  ]));

COMMIT;
