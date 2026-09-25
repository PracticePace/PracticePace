// ── Drill duration limits ────────────────────────────────────────────────────
// The Scripts duration fields used to accept anything: -4:-30 saved fine,
// 0:00 saved fine, and 99999 minutes rendered a script total of "100000:30".
// Zero and negative drills are worse than cosmetic — the practice timer skips
// straight past them, so a coach gets a drill that silently never runs.
//
// These live in their own module because BOTH ends need them and they must not
// drift apart:
//   • ScriptsSection.jsx — validates the add/edit forms, and clamps a script's
//     drills when the editor opens.
//   • practiceTimer.js   — clamps again in setActiveScript(), so a script
//     loaded straight to practice can't carry a sub-minimum drill even if the
//     coach never opened it in the editor.
//
// That second call site is the one that actually fixes the reported bug.
// Editor-only clamping meant the fix only landed if someone happened to open
// the script first; a coach tapping Load on an old script still got drills
// that vanished the instant practice reached them.

export const DUR_MAX_MINUTES = 60
export const DUR_MAX_SECONDS = 59
export const DUR_MIN_TOTAL   = 5                                            // seconds
export const DUR_MAX_TOTAL   = DUR_MAX_MINUTES * 60 + DUR_MAX_SECONDS       // 3659s

// Form validation, shared by the add form and the edit form so they can't
// drift apart. Returns { ok, seconds, message } — message is null when ok.
export function validateDuration(mins, secs) {
  const m = mins === '' || mins === null || mins === undefined ? 0 : Number(mins)
  const c = secs === '' || secs === null || secs === undefined ? 0 : Number(secs)

  if (!Number.isFinite(m) || !Number.isFinite(c) || !Number.isInteger(m) || !Number.isInteger(c)) {
    return { ok: false, seconds: 0, message: 'Enter whole numbers for minutes and seconds.' }
  }
  if (m < 0 || c < 0) {
    return { ok: false, seconds: 0, message: "Duration can't be negative." }
  }
  if (m > DUR_MAX_MINUTES) {
    return { ok: false, seconds: 0, message: `Minutes can't be more than ${DUR_MAX_MINUTES}.` }
  }
  if (c > DUR_MAX_SECONDS) {
    return { ok: false, seconds: 0, message: `Seconds can't be more than ${DUR_MAX_SECONDS}.` }
  }
  const seconds = m * 60 + c
  if (seconds < DUR_MIN_TOTAL) {
    return { ok: false, seconds, message: `Drills must be at least ${DUR_MIN_TOTAL} seconds.` }
  }
  return { ok: true, seconds, message: null }
}

// Clamp a drills array into [DUR_MIN_TOTAL, DUR_MAX_TOTAL].
//
// Returns { drills, changed } — `changed` is how many entries were actually
// adjusted, which the editor uses to tell the coach what happened instead of
// silently rewriting durations they didn't set. Unchanged drill objects keep
// their identity so React doesn't re-render rows that didn't move.
//
// Nothing here writes to the database. The editor keeps its existing
// write-on-next-edit behaviour, and practiceTimer holds the clamped copy in
// memory only — a coach who never edits the script never has it rewritten.
export function clampDrills(drills) {
  let changed = 0
  const out = (drills ?? []).map(d => {
    const raw = Number(d?.duration)
    const safe = !Number.isFinite(raw)
      ? DUR_MIN_TOTAL
      : Math.min(DUR_MAX_TOTAL, Math.max(DUR_MIN_TOTAL, Math.round(raw)))
    if (safe === raw) return d
    changed += 1
    return { ...d, duration: safe }
  })
  return { drills: out, changed }
}
