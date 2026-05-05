// ── practiceTimer.js ──────────────────────────────────────────────────────────
// Singleton timer — state lives in module scope, never in a React component.
// The setInterval tick runs even when PracticeSection is unmounted (tab switch).
// Components subscribe/unsubscribe; the timer keeps going regardless.
//
// Pattern matches audioPlayer.js: subscribe(fn) / getSnapshot() / actions.

import { playAirHorn, playWhistle, playPeriodEnd, loadHorn, getAutoSounds, setAutoSound } from './sounds'
import { duckForHorn, duckNow, releaseDuck } from './audioPlayer'

// ── Storage keys ──────────────────────────────────────────────────────────────
const STORAGE_KEY = 'pp_practice_timer'
const PREFS_KEY   = 'pp_practice_prefs'

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') } catch { return {} }
}
function savePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })) } catch {}
}

// ── Text-to-speech ────────────────────────────────────────────────────────────
// Voice is resolved once and cached.  On some browsers (Firefox, iOS Safari)
// the voices list is empty until the 'voiceschanged' event fires.
let _cachedVoice             = undefined   // undefined = unresolved, null = use browser default
let _voicesChangedRegistered = false
let _pendingSpeechTimer      = null        // setTimeout id for the 10-second announcement delay

// Voice priority: Daniel (iOS/macOS male) → Alex (macOS male) →
//   any voice with "male" in name → any English → browser default
function _resolveVoice(voices) {
  return voices.find(v => v.name?.includes('Daniel') && v.lang?.startsWith('en'))
    ?? voices.find(v => v.name?.includes('Alex')     && v.lang?.startsWith('en'))
    ?? voices.find(v => /male/i.test(v.name)          && v.lang?.startsWith('en'))
    ?? voices.find(v => v.lang?.startsWith('en'))
    ?? null
}

function _getEnglishVoice() {
  if (_cachedVoice !== undefined) return _cachedVoice   // already resolved

  if (typeof window === 'undefined' || !window.speechSynthesis) return null

  const voices = window.speechSynthesis.getVoices()

  if (voices.length > 0) {
    // Voices available synchronously (Chromium)
    _cachedVoice = _resolveVoice(voices)
    console.log('[PracticePace] TTS voice:', _cachedVoice?.name ?? '(browser default)')
    return _cachedVoice
  }

  // Voices not ready yet — register once and cache when they arrive
  if (!_voicesChangedRegistered) {
    _voicesChangedRegistered = true
    window.speechSynthesis.onvoiceschanged = () => {
      _cachedVoice = _resolveVoice(window.speechSynthesis.getVoices())
      console.log('[PracticePace] TTS voice:', _cachedVoice?.name ?? '(browser default)')
      window.speechSynthesis.onvoiceschanged = null
    }
  }
  return null   // browser will use its built-in default for this utterance
}

/**
 * Speak the announcement immediately.
 * The music duck is a fresh independent duck — by the time this runs
 * (10 s after the horn), the horn's 3-second duck has long since restored.
 */
function speakDrillName(name) {
  if (!name) return
  if (typeof window === 'undefined' || !window.speechSynthesis) return

  // Cancel any previously queued utterance (rapid double-advance guard)
  window.speechSynthesis.cancel()

  const utterance  = new SpeechSynthesisUtterance(`Next up. ${name}.`)
  utterance.rate   = 0.95   // slightly slower — authoritative, easier to hear at distance
  utterance.pitch  = 0.9    // slightly lower — sounds more masculine on most voices
  utterance.volume = 1.0

  const voice = _getEnglishVoice()
  if (voice) utterance.voice = voice

  // Fresh duck for the utterance — independent of the horn duck
  utterance.onstart = () => duckNow()
  utterance.onend   = () => releaseDuck()
  utterance.onerror = () => releaseDuck()

  window.speechSynthesis.speak(utterance)
}

/**
 * Cancel any pending announcement and schedule a new one 10 s from now.
 * Storing the timer id lets us cancel if the coach manually advances,
 * resets, or pauses before the announcement fires.
 */
function _scheduleSpeech(name) {
  if (_pendingSpeechTimer) { clearTimeout(_pendingSpeechTimer); _pendingSpeechTimer = null }
  _pendingSpeechTimer = setTimeout(() => {
    _pendingSpeechTimer = null
    speakDrillName(name)
  }, 10000)
}

/** Cancel any pending announcement (no-op if none is pending). */
function _cancelSpeech() {
  if (_pendingSpeechTimer) { clearTimeout(_pendingSpeechTimer); _pendingSpeechTimer = null }
}

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
  whistleAt60:      savedAutoSounds.whistleAt60  ?? true,
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

  // ── Whistle at 60s remaining ───────────────────────────────────────────────
  // Check at 61 so the whistle fires as the display changes to 1:00
  if (s.secondsLeft === 61 && s.whistleAt60) {
    playWhistle()
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
        // Speak the next drill name 200 ms after the horn fires so the two
        // don't overlap audibly.  Music stays ducked until speech finishes.
        const nextName = drills[nxt].name
        _scheduleSpeech(nextName)
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
  loadHorn()    // preload audio on first interaction
  s.isRunning  = !s.isRunning
  s.hasStarted = true
  if (s.isRunning) {
    startInterval()
  } else {
    stopInterval()
    _cancelSpeech()   // cancel pending announcement if paused
  }
  emit()
}

/** Reset to beginning of current script (or manual duration). */
export function reset() {
  _cancelSpeech()
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
  _cancelSpeech()
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
    // Speak the next drill name 200 ms after the horn fires.
    // Music stays ducked until speech finishes (same as auto-advance).
    const nextName = drills[nxt].name
    _scheduleSpeech(nextName)
    startInterval()
  } else {
    // Already at last drill — no speech, just stop
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
 * Called by Dashboard / PracticeSection when the active script changes.
 * Only resets the timer if the script actually changed (by id).
 */
export function setActiveScript(script) {
  const newId = script?.id ?? null
  const curId = s.activeScript?.id ?? null
  if (newId === curId) return    // same script — don't disturb a running timer

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

export function setWhistleAt60(val) {
  s.whistleAt60 = val
  setAutoSound('whistleAt60', val)
  emit()
}
