// ── practiceTimer.js ──────────────────────────────────────────────────────────
// Singleton timer — state lives in module scope, never in a React component.
// The setInterval tick runs even when PracticeSection is unmounted (tab switch).
// Components subscribe/unsubscribe; the timer keeps going regardless.
//
// Pattern matches audioPlayer.js: subscribe(fn) / getSnapshot() / actions.

import { playAirHorn, playBell, playPeriodEnd, loadHorn, getAutoSounds, setAutoSound } from './sounds'
import { duckForHorn, duckNow, releaseDuck } from './audioPlayer'
import { speakViaAudio } from './ttsViaAudio'

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
//
// iOS Safari reliability fixes applied:
//   • Re-resolve voice at speak-time if cache is still null (race at startup)
//   • Both synchronous getVoices() AND onvoiceschanged listener registered
//   • cancel() + 50 ms pause before speak() to clear stuck synth queue
//   • Utterance held in module-level var to prevent GC mid-speech
//   • Duck/restore calls wrapped in try/catch inside utterance handlers

let _cachedVoice             = undefined   // undefined = unresolved, null = use browser default
let _voicesChangedRegistered = false
let _pendingSpeechTimer      = null        // setTimeout id for the 3-second announcement delay
let _currentUtterance        = null        // held in module scope — prevents GC on iOS Safari
let _speechUnlocked          = false       // iOS requires a gesture-context speak() before async calls work

// Voice priority: Daniel (iOS/macOS male) → Alex (macOS male) →
//   any voice with "male" in name → any English → browser default
function _resolveVoice(voices) {
  return voices.find(v => v.name?.includes('Daniel') && v.lang?.startsWith('en'))
    ?? voices.find(v => v.name?.includes('Alex')     && v.lang?.startsWith('en'))
    ?? voices.find(v => /male/i.test(v.name)          && v.lang?.startsWith('en'))
    ?? voices.find(v => v.lang?.startsWith('en'))
    ?? null
}

function _initVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return

  // Try synchronously first (Chromium, and sometimes iOS after first load)
  const voices = window.speechSynthesis.getVoices()
  if (voices.length > 0) {
    _cachedVoice = _resolveVoice(voices)
    console.log('[TTS] selected voice:', _cachedVoice?.name ?? '(browser default)')
    return
  }

  // Also register onvoiceschanged — some browsers only fire the event, not sync
  if (!_voicesChangedRegistered) {
    _voicesChangedRegistered = true
    window.speechSynthesis.onvoiceschanged = () => {
      const v = window.speechSynthesis.getVoices()
      console.log('[TTS] voiceschanged fired,', v.length, 'voices available')
      _cachedVoice = _resolveVoice(v)
      console.log('[TTS] selected voice:', _cachedVoice?.name ?? '(browser default)')
      window.speechSynthesis.onvoiceschanged = null
    }
  }
}

// Kick off voice resolution at module load
_initVoices()

function _getEnglishVoice() {
  // If still undefined, try once more synchronously (voices may have loaded
  // since module init without firing onvoiceschanged, e.g. on iOS after unlock)
  if (_cachedVoice === undefined) {
    const voices = window.speechSynthesis?.getVoices() ?? []
    if (voices.length > 0) {
      _cachedVoice = _resolveVoice(voices)
      console.log('[TTS] selected voice (late resolve):', _cachedVoice?.name ?? '(browser default)')
    } else {
      // Still not ready — fall back to null (browser picks default)
      return null
    }
  }
  return _cachedVoice   // may be null — that's fine, means browser default
}

/**
 * Speak the announcement immediately.
 * The music duck is a fresh independent duck — by the time this runs
 * (3 s after the horn), the horn's 3-second duck has just about restored.
 *
 * Delegates to speakViaAudio() which attempts to capture the synthesized
 * speech into an audio buffer and play it through an HTMLAudioElement
 * (so iOS Safari routes it through AirPlay — see ttsViaAudio.js for the
 * full theory and caveats). On any failure, speakViaAudio() falls back
 * to a regular window.speechSynthesis.speak() so this announcement
 * always plays — even if it remains stuck on the local iPad speaker.
 *
 * Voice / rate / pitch / volume preserved exactly from the prior direct-
 * speechSynthesis path:
 *   text  = "Next up. ${name}."
 *   rate  = 0.95   (slightly slower — authoritative, easier at distance)
 *   pitch = 0.9    (slightly lower — sounds more masculine)
 *   volume= 1.0
 *   voice = Daniel → Alex → male/en → en → browser default
 *
 * Ducking orchestration is unchanged: duckNow() on speech start,
 * releaseDuck() on speech end (whether captured-blob path or fallback
 * path). Always exactly one onStart / onEnd pair per call.
 */
function speakDrillName(name) {
  if (!name) return
  if (typeof window === 'undefined' || !window.speechSynthesis) return

  const text = `Next up. ${name}.`
  console.log('[TTS] 3s elapsed, calling speakViaAudio() with:', text)
  console.log('[TTS] synth state — speaking:', window.speechSynthesis.speaking,
    'pending:', window.speechSynthesis.pending,
    'paused:', window.speechSynthesis.paused)

  // iOS quirk: resume in case the synth got suspended between uses
  try { window.speechSynthesis.resume() } catch {}

  const voice = _getEnglishVoice() // may be null — that's fine, helper passes null through

  // Hold the in-flight promise on the module-level ref so the captured
  // <audio> element (or fallback utterance, depending on path) isn't
  // GC'd mid-playback on iOS. Same protective intent as the previous
  // _currentUtterance ref.
  const promise = speakViaAudio(text, {
    rate:   0.95,
    pitch:  0.9,
    volume: 1.0,
    voice,
    onStart: () => {
      console.log('[TTS] speech started')
      try { duckNow() } catch (e) { console.warn('[TTS] duckNow error:', e) }
    },
    onEnd: () => {
      console.log('[TTS] speech ended')
      _currentUtterance = null
      try { releaseDuck() } catch (e) { console.warn('[TTS] releaseDuck error:', e) }
    },
  })
  // Repurpose the GC-protection slot to hold the in-flight promise. Same
  // role as before — keeps a strong reference until completion.
  _currentUtterance = promise
  promise.catch(err => {
    // speakViaAudio() is designed never to reject, but defend against it
    // anyway so a rogue rejection doesn't leave the music ducked forever.
    console.error('[TTS] speakViaAudio rejected (should not happen):', err)
    _currentUtterance = null
    try { releaseDuck() } catch {}
  })
}

/**
 * Cancel any pending announcement and schedule a new one 3 s from now.
 * Storing the timer id lets us cancel if the coach manually advances,
 * resets, or pauses before the announcement fires.
 */
function _scheduleSpeech(name) {
  if (_pendingSpeechTimer) { clearTimeout(_pendingSpeechTimer); _pendingSpeechTimer = null }
  console.log('[TTS] drill ended, scheduling announcement in 3s for:', name)
  _pendingSpeechTimer = setTimeout(() => {
    _pendingSpeechTimer = null
    speakDrillName(name)
  }, 3000)
}

/** Cancel any pending announcement (no-op if none is pending). */
function _cancelSpeech() {
  if (_pendingSpeechTimer) {
    console.log('[TTS] cancelling pending announcement (manual next or stop)')
    clearTimeout(_pendingSpeechTimer)
    _pendingSpeechTimer = null
  }
}

/**
 * iOS Safari requires speechSynthesis.speak() to be called synchronously
 * inside a user-gesture handler at least once before async calls (setTimeout)
 * will work.  Call this from every button handler that could lead to speech.
 * The silent utterance grants permission without making a sound.
 */
function _unlockSpeech() {
  if (_speechUnlocked) return
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  _speechUnlocked = true
  const u = new SpeechSynthesisUtterance('')
  u.volume = 0
  window.speechSynthesis.speak(u)
  console.log('[TTS] speechSynthesis unlocked via user gesture')
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
  loadHorn()         // preload audio on first interaction
  _unlockSpeech()    // grant iOS permission for later async speak() calls
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
  _unlockSpeech()            // grant iOS permission for the upcoming async speak()
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
