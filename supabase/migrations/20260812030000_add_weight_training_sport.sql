-- Add "Weight Training" as a first-class sport (before Custom in the
-- launch list, per src/lib/sports.js).
--
-- Mirrors migration 20260521000000's pattern exactly: rewrite both
-- organizations_sport_check and scripts_sport_check to add
-- 'weight_training' to the allowed set, keeping every previously-allowed
-- value (launch list + grandfathered legacy values) untouched.
--
-- Also migrates Aggie Weightroom (org a84a93ab-d8a0-46bd-852f-53000cf558ca)
-- off sport='custom' (sport_custom_label was 'Weightlifting') onto the new
-- first-class value, clearing sport_custom_label per the established
-- convention (non-custom sports carry a NULL label). Its one script
-- ("TUESDAY LIFT 1", id 66def4f5-cbb5-4513-87fe-0e3371ab3eff) is migrated
-- alongside it — scripts.sport otherwise would have drifted out of sync
-- with its own program's sport.

BEGIN;

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
    'weight_training'::text,
    'custom'::text,
    -- ── Grandfathered legacy values ─────────────────────────────────
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
    'weight_training'::text,
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

-- Migrate Aggie Weightroom off sport='custom'.
UPDATE public.organizations
SET sport = 'weight_training', sport_custom_label = NULL
WHERE id = 'a84a93ab-d8a0-46bd-852f-53000cf558ca';

UPDATE public.scripts
SET sport = 'weight_training'
WHERE org_id = 'a84a93ab-d8a0-46bd-852f-53000cf558ca' AND sport = 'custom';

COMMIT;
