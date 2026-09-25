// ── scoreboardStore.js ────────────────────────────────────────────────────────
// Singleton scoreboard state — module scope, never inside a React component.
// Same shape and philosophy as practiceTimer.js: subscribe(fn) / getSnapshot()
// / actions, with the tick living here so it survives unmount.
//
// WHY THIS EXISTS
// The scoreboard is used during practice to simulate game scenarios — most
// often a two-minute offense drill. Dashboard renders sections conditionally
// ({section === 'scoreboard' && <ScoreboardSection/>}), so tabbing to Practice
// UNMOUNTED the whole subtree and every useState with it: score, clocks, down
// and distance, all back to 0-0 and 10:00. Holding the state out here makes the
// tab switch a non-event.
//
// TWO PATHS, DELIBERATELY DIFFERENT
//   Tab switch — nothing is saved or restored, because nothing stopped. The
//     interval below is owned by the module, so unmounting the component does
//     not touch it. The coach returns to a still-running clock showing real
//     elapsed time, with no button to press. This is the case that matters:
//     mid-drill, a clock that pauses itself is wrong.
//   Reload — restoreFromStorage() advances every running clock by the wall
//     clock time that passed, then forces running:false. A stadium clock that
//     silently ran while the iPad was shut is worse than one the coach restarts.
//
// Those do not conflict: the first is "the interval never stopped", the second
// is a one-shot reconciliation at module load. They share the state, not the
// mechanism.
//
// THROTTLING
// Browsers throttle setInterval in a backgrounded browser tab, and an iPad that
// sleeps stops it outright. An in-app tab switch keeps the page visible so the
// tick is unaffected, but locking the iPad is not. So every tick decrements by
// measured wall-clock elapsed rather than assuming 1s, and a visibilitychange
// listener reconciles on return — the same defence practiceTimer has.
//
// SCOPE: per program (orgId), then per surface. A basketball score restored
// into a football program would be meaningless, and sportToScoreboard() already
// picks the surface from the program's sport.
//
// STORAGE: localStorage, matching the pp_ convention. Not the database —
// guests get the Scoreboard tab but have no account row (accountId is null), so
// a DB-backed board would simply not work for them, and a running clock emits
// every second which is untenable as DB writes.
//
// NOT INCLUDED: Tabata. Its clock is an interval workout, not a game clock;
// resuming a half-finished round after the coach looked away is the wrong
// behaviour. Football team names are also excluded — they already persist to
// accounts.home_team_name / away_team_name, and two sources of truth for one
// field is worse than the inconsistency.

const STORAGE_KEY = 'pp_scoreboard'

// A board older than this is discarded rather than restored. A scoreboard that
// comes back showing 21-14 from three weeks ago is worse than a clean reset.
const MAX_AGE_MS = 12 * 60 * 60 * 1000

// Which fields on each surface are clocks, as [secondsField, runningField].
// The tick walks these; everything else is opaque state the store just holds.
const CLOCK_FIELDS = {
  football:   [['gameSecs', 'gameRun'], ['playSecs', 'playRun']],
  basketball: [['gameSecs', 'gameRun'], ['shotSecs', 'shotRun']],
  cheer:      [['secsLeft', 'running']],
  generic:    [['gameSecs', 'gameRun']],
}

// Transient UI that must never be restored — coming back into a half-typed
// rename or an open editor is worse than not persisting it at all.
const TRANSIENT = new Set([
  'editingHome', 'editingAway', 'homeDraft', 'awayDraft',
  'editingBallOn', 'editingClock', 'clockDraft',
])

// { [orgId]: { [surface]: { state, savedAt } } }
let boards = {}
let lastTickAt = Date.now()
let intervalId = null
const listeners = new Set()

function clocksFor(surface) {
  return CLOCK_FIELDS[surface] ?? []
}

function hasRunningClock() {
  for (const bySurface of Object.values(boards)) {
    for (const [surface, entry] of Object.entries(bySurface)) {
      for (const [, runField] of clocksFor(surface)) {
        if (entry?.state?.[runField]) return true
      }
    }
  }
  return false
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards, savedAt: Date.now() }))
  } catch { /* quota or private mode — state still works in memory */ }
}

function emit() {
  for (const fn of listeners) fn()
  persist()
}

// Advance every running clock on one board by `elapsedSecs`, stopping at zero.
// Returns true if anything changed.
function advanceBoard(surface, state, elapsedSecs) {
  let changed = false
  for (const [secsField, runField] of clocksFor(surface)) {
    if (!state[runField]) continue
    const cur = Number(state[secsField]) || 0
    const next = Math.max(0, cur - elapsedSecs)
    if (next !== cur) { state[secsField] = next; changed = true }
    if (next === 0 && state[runField]) { state[runField] = false; changed = true }
  }
  return changed
}

// ── Restore (reload path) ─────────────────────────────────────────────────────
// Advance by real elapsed time, then stop every clock.
;(function restoreFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (!saved?.boards) return

    const now = Date.now()
    const restored = {}

    for (const [orgId, bySurface] of Object.entries(saved.boards)) {
      for (const [surface, entry] of Object.entries(bySurface ?? {})) {
        if (!entry?.state) continue
        const age = now - (entry.savedAt ?? saved.savedAt ?? 0)
        if (age > MAX_AGE_MS) continue          // stale — drop it

        const state = { ...entry.state }
        const elapsed = Math.max(0, Math.floor(age / 1000))
        if (elapsed > 0) advanceBoard(surface, state, elapsed)

        // Reload always comes back paused, however the clocks were left.
        for (const [, runField] of clocksFor(surface)) state[runField] = false
        for (const k of TRANSIENT) delete state[k]

        restored[orgId] = restored[orgId] ?? {}
        restored[orgId][surface] = { state, savedAt: now }
      }
    }
    boards = restored
  } catch { /* corrupt storage — start clean */ }
})()

// ── Tick ──────────────────────────────────────────────────────────────────────
// Measured elapsed, not an assumed 1s, so a throttled or suspended interval
// self-corrects on its next run instead of drifting slow.
function tick() {
  const now = Date.now()
  const elapsed = Math.floor((now - lastTickAt) / 1000)
  if (elapsed < 1) return
  lastTickAt = now

  let changed = false
  for (const bySurface of Object.values(boards)) {
    for (const [surface, entry] of Object.entries(bySurface)) {
      if (!entry?.state) continue
      if (advanceBoard(surface, entry.state, elapsed)) {
        entry.savedAt = now
        changed = true
      }
    }
  }
  if (changed) emit()
  if (!hasRunningClock()) stopInterval()
}

function startInterval() {
  if (intervalId !== null) return
  lastTickAt = Date.now()
  intervalId = setInterval(tick, 1000)
}

function stopInterval() {
  if (intervalId === null) return
  clearInterval(intervalId)
  intervalId = null
}

// Reconcile after the browser throttled or suspended us (iPad sleep, backgrounded
// browser tab). An in-app section switch keeps the page visible and never needs
// this, but locking the device does.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && intervalId !== null) tick()
  })
}

// ── Public API ────────────────────────────────────────────────────────────────
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Returns the persisted state for one board, seeded with `defaults` for any
// field it has never held. Defaults win for transient fields.
export function getBoardState(orgId, surface, defaults) {
  const entry = boards?.[orgId]?.[surface]
  if (!entry?.state) return { ...defaults }
  return { ...defaults, ...entry.state }
}

export function patchBoard(orgId, surface, patch) {
  if (!orgId || !surface) return
  boards[orgId] = boards[orgId] ?? {}
  const prev = boards[orgId][surface]?.state ?? {}
  const next = { ...prev, ...patch }
  for (const k of TRANSIENT) delete next[k]
  boards[orgId][surface] = { state: next, savedAt: Date.now() }

  if (hasRunningClock()) startInterval()
  else stopInterval()
  emit()
}

// Drop one board back to nothing — used by the surfaces' Reset buttons.
export function clearBoard(orgId, surface) {
  if (boards?.[orgId]?.[surface]) {
    delete boards[orgId][surface]
    if (Object.keys(boards[orgId]).length === 0) delete boards[orgId]
  }
  if (!hasRunningClock()) stopInterval()
  emit()
}
