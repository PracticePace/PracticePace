// ── Sample-script seeds (sport-aware) ────────────────────────────────────────
// Returned for new programs that have no scripts yet. Two seed sites:
//   • src/pages/Dashboard.jsx — auth path (`seedSampleScript`)
//   • src/lib/guestStorage.js — guest path (`seedGuestIfEmpty`)
// Both call getSampleScriptForSport(sport) so adding a new sport-specific
// sample is a one-place change.
//
// Drill shape matches the existing scripts.drills jsonb column:
//   { name: string, duration: number-of-seconds }
// No notes, cue_mp3_url, show_notes, or other optional fields — coaches
// fill those in if they want them. Keeping the seed minimal also avoids
// any drift between seeds and the script editor's defaults.
//
// Behaviour:
//   • sport === 'cheerleading'  → cheer-specific 15-drill comp prep
//   • everything else            → the original "Sample Practice — 90 min"
//                                  (7-drill football-shaped block that
//                                  reads fine for football / basketball /
//                                  soccer / volleyball / baseball /
//                                  softball / flag football / custom).
// Add more sport branches here when product wants them — don't sprinkle
// drill arrays back into Dashboard.jsx or guestStorage.js.

// ── Default (football-shaped, used for every non-cheer sport) ────────────────
const DEFAULT_NAME   = 'Sample Practice — 90 min'
const DEFAULT_DRILLS = [
  { name: 'Warm Up & Stretch',      duration: 10 * 60 },
  { name: 'Individual / Position',  duration: 20 * 60 },
  { name: 'Group / Unit Period',    duration: 15 * 60 },
  { name: 'Team Period',            duration: 25 * 60 },
  { name: 'Special Teams',          duration: 10 * 60 },
  { name: 'Conditioning',           duration:  8 * 60 },
  { name: 'Cool Down',              duration:  2 * 60 },
]

// ── Cheerleading sample (15 drills, competition-week shape) ──────────────────
const CHEER_NAME   = 'Competition Week — Polish & Run-Throughs'
const CHEER_DRILLS = [
  { name: 'Dynamic Warm-Up & Cardio',                            duration: 10 * 60 },
  { name: 'Active Stretching & Flexibility',                     duration: 10 * 60 },
  { name: 'Motion Drills — Sharp & Synced',                      duration: 10 * 60 },
  { name: 'Jumps Block',                                         duration: 15 * 60 },
  { name: 'Standing Tumbling Pass',                              duration: 10 * 60 },
  { name: 'Running Tumbling Pass',                               duration: 10 * 60 },
  { name: 'Water Break',                                         duration:  5 * 60 },
  { name: 'Stunt Sections — Group Drilling',                     duration: 15 * 60 },
  { name: 'Pyramid — Walk Through Twice, Up to Speed Twice',     duration: 10 * 60 },
  { name: 'Cheer Section — Voice & Motions',                     duration: 10 * 60 },
  { name: 'Dance Section',                                       duration: 15 * 60 },
  { name: 'Full Routine Run-Through #1',                         duration: 10 * 60 },
  { name: 'Review & Targeted Fixes',                             duration: 10 * 60 },
  { name: 'Full Routine Run-Through #2',                         duration: 10 * 60 },
  { name: 'Cool Down & Team Talk',                               duration: 10 * 60 },
]

// Returns { name, drills } for the given sport. Pure function — callers
// own the actual INSERT (auth path) or localStorage write (guest path).
export function getSampleScriptForSport(sport) {
  const key = typeof sport === 'string' ? sport.toLowerCase() : ''
  if (key === 'cheerleading') {
    return { name: CHEER_NAME, drills: CHEER_DRILLS }
  }
  return { name: DEFAULT_NAME, drills: DEFAULT_DRILLS }
}
