// ── Sport list (shared) ──────────────────────────────────────────────────────
// Used by the org sport selector in Onboarding and Settings. The same set of
// canonical lowercase values is enforced on the Postgres side via
// organizations_sport_check and scripts_sport_check — see the matching
// migration at supabase/migrations/20260506000001_expand_sports_check_constraint.sql.
//
// Sorted alphabetically by label, with "Other" pinned to the end.
//
// `value` is the canonical lowercase string we persist; `label` is the
// display text shown in dropdowns.

export const SPORTS = [
  { value: 'baseball',        label: 'Baseball' },
  { value: 'basketball',      label: 'Basketball' },
  { value: 'cheerleading',    label: 'Cheerleading' },
  { value: 'cross country',   label: 'Cross Country' },
  { value: 'dance',           label: 'Dance' },
  { value: 'dance team',      label: 'Dance Team' },
  { value: 'football',        label: 'Football' },
  { value: 'golf',            label: 'Golf' },
  { value: 'gymnastics',      label: 'Gymnastics' },
  { value: 'hockey',          label: 'Hockey' },
  { value: 'lacrosse',        label: 'Lacrosse' },
  { value: 'soccer',          label: 'Soccer' },
  { value: 'softball',        label: 'Softball' },
  { value: 'stunt',           label: 'Stunt' },
  { value: 'swimming',        label: 'Swimming' },
  { value: 'tennis',          label: 'Tennis' },
  { value: 'track and field', label: 'Track and Field' },
  { value: 'volleyball',      label: 'Volleyball' },
  { value: 'wrestling',       label: 'Wrestling' },
  { value: 'other',           label: 'Other' },
]

// Sports that share a "competition routine + score" workflow rather than
// the football/basketball game-clock model. Used by the Scoreboard tab to
// auto-default these programs to the CheerScoreboard (count-down timer +
// optional score) instead of the football/basketball picker. Easy to
// extend later (e.g. gymnastics, wrestling tournament timer) without
// touching the scoreboard component itself.
export const COMPETITION_SPORTS = new Set([
  'cheerleading',
  'stunt',
  'dance',
  'dance team',
])
