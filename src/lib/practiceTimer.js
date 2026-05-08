// ── practiceTimer.js ──────────────────────────────────────────────────────────
// Singleton timer — state lives in module scope, never in a React component.
// The setInterval tick runs even when PracticeSection is unmounted (tab switch).
// Components subscribe/unsubscribe; the timer keeps going regardless.
//
// Pattern matches audioPlayer.js: subscribe(fn) / getSnapshot() / actions.

import { playAirHorn, playBell, playPeriodEnd, loadHorn, getAutoSounds, setAutoSound } from './sounds'
import { duckForHorn } from './audioPlayer'

// ── Storage keys ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'pp_practice_timer'
const PREFS_KEY   = 'pp_practice_prefs'

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') } catch { return {} }
}
function savePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })) } catch {}
}

// (Drill-announcement TTS removed: iOS Safari can't AirPlay
// speechSynthesis to a mirrored Apple TV, and practices are always
// run mirrored, so the announcement only played on the iPad — not
// useful. Visual cues — drill name, "Next Up", timer — still convey
// drill transitions on the screen.)

// Also pull from getAutoSounds() so horn/whistle toggles stay in sync with
// the Audio tab's sound settings (they use the same underlying key).
const savedAutoSounds = getAutoSounds()
const savedPrefs      = loadPrefs()

// ── Singleton state ───────────────────────────────────────────────────────────
let s = {
  isRunning:        false,
  hasStarted:       false,
  secondsLeft:      0,
  totalSeconds:     0,
  currentDrillIdx:  0,
  activeScript:     null,
  isOverrun:        false,
  overrunSeconds:   0,
  manualDuration:   300,     // Quick Timer default: 5 min
  savedAt:          null,    // wall-clock ms of the last tick save — used by catchUp()
  // coach preferences
  autoAdvance:      savedPrefs.autoAdvance  ?? true,
  allowOverrun:     savedPrefs.allowOverrun ?? false,
  hornOnEnd:        savedAutoSounds.hornOnEnd    ?? true,
  // bellAt30 replaced the legacy whistleAt60 trigger. Migration: if a coach
  // previously toggled whistleAt60 off, carry that disabled state forward
  // — the semantic ("alert near end of drill") is the same, only the sound
  // and threshold changed. New installs default to true.
  bellAt30:         savedAutoSounds.bellAt30 ?? savedAutoSounds.whistleAt60 ?? true,
}

// ── Restore persisted timer snapshot (handles page refresh) ───────────────────
;(function restoreFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (!saved) return

    // Compute how much time elapsed since last save
    const elapsed = saved.savedAt
      ? Math.max(0, Math.floor((Date.now() - saved.savedAt) / 1000))
      : 0

    let secondsLeft = saved.secondsLeft ?? 0
    // If the timer was running when the page closed, subtract elapsed time
    if (saved.isRunning && elapsed > 0 && !saved.isOverrun) {
      secondsLeft = Math.max(0, secondsLeft - elapsed)
    }

    s = {
      ...s,
      ...saved,
      isRunning:    false,   // interval is gone after refresh — coach must press Start
      secondsLeft,
    }
  } catch { /* ignore corrupt storage */ }
})()

function persistState() {
  try {
    s.savedAt = Date.now()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s }))
  } catch {}
}

// ── Catch-up after browser suspension ────────────────────────────────────────
// Called whenever the tab becomes visible again.  We compute how many seconds
// elapsed since the last tick, then forward-simulate through the drill sequence
// so the display jumps to wherever the timer *should* be.

function catchUp() {
  if (!s.isRunning) return       // nothing to catch up
  if (!s.savedAt)   return       // no anchor — can't compute

  const elapsed = Math.max(0, Math.floor((Date.now() - s.savedAt) / 1000))
  if (elapsed <= 1) return       // only a brief gap — interval handles it

  // Already in overrun — just accumulate elapsed time and bail
  if (s.isOverrun) {
    s.overrunSeconds += elapsed
    s.savedAt = Date.now()
    emit()
    return
  }

  // Forward-simulate elapsed seconds through the drill sequence
  let remaining = elapsed
  const drills  = s.activeScript?.drills ?? []

  while (remaining > 0) {
    if (s.secondsLeft > remaining) {
      // Still in the same drill
      s.secondsLeft -= remaining
      remaining = 0
    } else {
      // Current drill expires
      remaining -= s.secondsLeft
      s.secondsLeft = 0

      const nxt = s.currentDrillIdx + 1

      if (s.autoAdvance && nxt < drills.length) {
        // Advance to next drill and keep consuming time
        s.currentDrillIdx = nxt
        const dur      = Number(drills[nxt].duration) || 0
        s.secondsLeft  = dur
        s.totalSeconds = dur
        s.isOverrun    = false
        s.overrunSeconds = 0
      } else if (s.allowOverrun) {
        // Entered overrun
        s.isOverrun      = true
        s.overrunSeconds = remaining
        remaining = 0
      } else {
        // Timer stops
        s.isRunning   = false
        s.secondsLeft = 0
        stopInterval()
        remaining = 0
      }
    }
  }

  s.savedAt = Date.now()
  emit()
}

// Register once at module load — fires on every tab-visible event
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') catchUp()
  })
}

// ── Pub-sub ───────────────────────────────────────────────────────────────────
const listeners = new Set()

function emit() {
  const snap = getSnapshot()
  for (const fn of listeners) fn(snap)
  persistState()
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSnapshot() {
  return { ...s }
}

// ── Interval (lives in module scope forever) ──────────────────────────────────
let intervalId = null

function startInterval() {
  if (intervalId !== null) return        // already running — don't double-start
  intervalId = setInterval(tick, 1000)
}

function stopInterval() {
  if (intervalId === null) return
  clearInterval(intervalId)
  intervalId = null
}

function tick() {
  if (!s.isRunning) return

  // ── Overrun mode ───────────────────────────────────────────────────────────
  if (s.isOverrun) {
    s.overrunSeconds += 1
    emit()
    return
  }

  // ── Bell at 30s remaining ──────────────────────────────────────────────────
  // Check at 31 so the bell fires as the display changes to 0:30. Replaces
  // the previous 1:00 whistle — coaches asked for a later, less-jarring cue.
  if (s.secondsLeft === 31 && s.bellAt30) {
    playBell()
  }

  // ── Time's up ─────────────────────────────────────────────────────────────
  if (s.secondsLeft <= 1) {
    // Blow horn (duck MP3, play horn, restore after 3 s)
    if (s.hornOnEnd) duckForHorn(playAirHorn)

    // Auto-advance to the next drill?
    if (s.autoAdvance) {
      const drills = s.activeScript?.drills ?? []
      const nxt    = s.currentDrillIdx + 1
      if (nxt < drills.length) {
        s.currentDrillIdx = nxt
        const dur         = Number(drills[nxt].duration) || 0
        s.secondsLeft     = dur
        s.totalSeconds    = dur
        s.isOverrun       = false
        s.overrunSeconds  = 0
        emit()
        return
      }
    }

    // Overrun allowed?
    if (s.allowOverrun) {
      s.isOverrun      = true
      s.secondsLeft    = 0
      s.overrunSeconds = 0
      playPeriodEnd()
      emit()
      return
    }

    // Stop
    s.isRunning   = false
    s.secondsLeft = 0
    stopInterval()
    emit()
    return
  }

  s.secondsLeft -= 1
  emit()
}

// ── Public actions ────────────────────────────────────────────────────────────

/** Toggle play / pause. */
export function startPause() {
  loadHorn()         // preload audio on first interaction
  s.isRunning  = !s.isRunning
  s.hasStarted = true
  if (s.isRunning) {
    startInterval()
  } else {
    stopInterval()
  }
  emit()
}

/** Reset to beginning of current script (or manual duration). */
export function reset() {
  stopInterval()
  s.isRunning       = false
  s.hasStarted      = false
  s.isOverrun       = false
  s.overrunSeconds  = 0
  s.currentDrillIdx = 0
  const dur      = s.activeScript?.drills?.[0]?.duration ?? s.manualDuration
  s.secondsLeft  = Number(dur) || 0
  s.totalSeconds = Number(dur) || 0
  emit()
}

/** Jump to a specific drill index (stops timer). */
export function jumpTo(i) {
  const drills = s.activeScript?.drills ?? []
  if (i < 0 || i >= drills.length) return
  stopInterval()
  s.isRunning       = false
  s.isOverrun       = false
  s.overrunSeconds  = 0
  s.currentDrillIdx = i
  const dur      = Number(drills[i]?.duration) || s.manualDuration
  s.secondsLeft  = dur
  s.totalSeconds = dur
  emit()
}

/**
 * Next: blow horn immediately → advance to next drill → auto-start timer.
 * This is the "real practice flow" — coach hits Next and the next period
 * starts without requiring another press of Start.
 */
export function next() {
  duckForHorn(playAirHorn)   // horn fires immediately

  const drills = s.activeScript?.drills ?? []
  const nxt    = s.currentDrillIdx + 1

  if (nxt < drills.length) {
    s.currentDrillIdx = nxt
    s.isOverrun       = false
    s.overrunSeconds  = 0
    const dur      = Number(drills[nxt].duration) || 0
    s.secondsLeft  = dur
    s.totalSeconds = dur
    s.isRunning    = true    // ← auto-start
    s.hasStarted   = true
    startInterval()
  } else {
    // Already at last drill — just stop
    stopInterval()
    s.isRunning = false
  }
  emit()
}

/** Set timer to an explicit number of seconds (stops timer, updates manual duration). */
export function setTimeTo(secs) {
  stopInterval()
  s.isRunning     = false
  s.isOverrun     = false
  s.overrunSeconds = 0
  s.secondsLeft   = secs
  s.totalSeconds  = secs
  if (!s.activeScript) s.manualDuration = secs
  emit()
}

/** Add 60 seconds to the current countdown (also clears overrun). */
export function addMinute() {
  const newVal    = s.secondsLeft + 60
  s.secondsLeft   = newVal
  if (newVal > s.totalSeconds) s.totalSeconds = newVal
  if (s.isOverrun) { s.isOverrun = false; s.overrunSeconds = 0 }
  emit()
}

/**
 * Subtract 60 seconds from the current countdown, floored at 0.
 * One-time adjustment to the running clock — does NOT modify the drill's
 * saved duration. If the timer is running and this drops secondsLeft to 0,
 * the next tick triggers the existing end-of-drill flow (horn, voice,
 * auto-advance), which is intentional.
 */
export function subtractMinute() {
  s.secondsLeft = Math.max(0, s.secondsLeft - 60)
  emit()
}

/**
 * Called by Dashboard / PracticeSection when the active script changes.
 * Only resets the timer if the script actually changed (by id).
 *
 * Same-id case still REFRESHES s.activeScript to the new reference. The
 * caller may be passing an updated copy of the same script (e.g. a drill
 * was edited in the Scripts editor — added cue_mp3_url, notes,
 * show_notes — and then re-loaded to Practice). If we kept the stale
 * reference, PracticeSection would read pre-edit drill data and miss the
 * new fields. Timer-state fields (isRunning, currentDrillIdx, etc.) are
 * still preserved across same-id calls so a running practice isn't
 * disturbed.
 */
export function setActiveScript(script) {
  const newId = script?.id ?? null
  const curId = s.activeScript?.id ?? null
  console.log('[ACTIVE] practiceTimer.setActiveScript called — newId:', newId, 'curId:', curId, 'name:', script?.name ?? null)
  if (newId === curId) {
    // Refresh drills/name/sport/etc. without disturbing the running timer.
    // (Even on same-id we update the reference — caller may be handing us
    // an edited copy with new cue_mp3_url / notes / show_notes fields.)
    console.log('[ACTIVE] practiceTimer.setActiveScript: same id — refreshing reference, preserving timer state')
    s.activeScript = script ?? null
    emit()
    return
  }

  s.activeScript    = script ?? null
  stopInterval()
  s.isRunning       = false
  s.hasStarted      = false
  s.isOverrun       = false
  s.overrunSeconds  = 0
  s.currentDrillIdx = 0
  const dur      = script?.drills?.[0]?.duration ?? s.manualDuration
  s.secondsLeft  = Number(dur) || 0
  s.totalSeconds = Number(dur) || 0
  emit()
}

// ── Preference setters ────────────────────────────────────────────────────────

export function setAutoAdvance(val) {
  s.autoAdvance = val
  savePrefs({ autoAdvance: val })
  emit()
}

export function setAllowOverrun(val) {
  s.allowOverrun = val
  savePrefs({ allowOverrun: val })
  emit()
}

export function setHornOnEnd(val) {
  s.hornOnEnd = val
  setAutoSound('hornOnEnd', val)    // keep in sync with sounds.js persistence
  emit()
}

export function setBellAt30(val) {
  s.bellAt30 = val
  setAutoSound('bellAt30', val)
  emit()
}
