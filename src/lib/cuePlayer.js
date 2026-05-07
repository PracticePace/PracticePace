// ── Per-drill cue MP3 singleton ──────────────────────────────────────────────
// One-shot audio: when the active drill on the practice screen has a
// cue_mp3_url, the orchestrator in PracticeSection.jsx pauses the main music
// player, calls playCue(url, onEnded), then resumes the main player when
// onEnded fires (only on natural end / load error, NOT on stopCue).
//
// Pattern mirrors src/lib/stadiumNoise.js but stripped further: there is at
// most ONE cue audio element alive at a time. Starting a new cue stops any
// previous one silently (no callback fires). Stopping a cue manually
// (stopCue) also runs silently — the orchestrator handles its own resume
// logic in those branches.
//
// We deliberately do NOT participate in the music player's lock or volume
// ducking. The orchestrator pauses the main player explicitly, so there's
// nothing to duck against.

let audio       = null    // HTMLAudioElement, lazily created per playCue
let endedCb     = null    // callback to fire on natural end / error

function clearAudio() {
  if (!audio) return
  // Detach handlers BEFORE pause so a stale 'ended'/'error' event from this
  // particular element (e.g. queued in the event loop) can't fire after
  // we've moved on.
  audio.onended = null
  audio.onerror = null
  audio.pause()
  // Clearing src lets the browser release the buffer immediately.
  audio.src = ''
  audio = null
}

/**
 * Start playing the cue at `url`. Stops any in-flight cue silently.
 * `onEnded` fires once when the cue finishes naturally OR errors. It
 * does NOT fire when stopCue() is called by the orchestrator.
 */
export async function playCue(url, { onEnded } = {}) {
  // Stop any currently-playing cue without invoking its onEnded — a brand
  // new cue is replacing it, the orchestrator will (re)decide what to do
  // with the main player.
  clearAudio()
  endedCb = null

  const a = new Audio(url)
  a.preload = 'auto'
  a.volume  = 1.0

  a.addEventListener('ended', () => {
    if (audio !== a) return        // a newer cue (or stop) replaced us
    const cb = endedCb
    audio   = null
    endedCb = null
    if (typeof cb === 'function') { try { cb() } catch {} }
  })

  a.addEventListener('error', () => {
    if (audio !== a) return
    console.error('[cuePlayer] error loading cue:', a.src)
    const cb = endedCb
    audio   = null
    endedCb = null
    // Treat error as end — main player should still resume.
    if (typeof cb === 'function') { try { cb() } catch {} }
  })

  audio   = a
  endedCb = typeof onEnded === 'function' ? onEnded : null

  try {
    await a.play()
  } catch (err) {
    // Play failed (autoplay policy, etc). Behave as error path.
    if (audio === a) {
      const cb = endedCb
      audio   = null
      endedCb = null
      console.error('[cuePlayer] play() rejected:', err?.message ?? err)
      if (typeof cb === 'function') { try { cb() } catch {} }
    }
  }
}

/**
 * Abort the current cue (if any). DOES NOT fire the onEnded callback —
 * the caller is taking responsibility for whatever comes next.
 */
export function stopCue() {
  endedCb = null
  clearAudio()
}

/** Whether a cue is currently playing. Synchronous, side-effect free. */
export function isCuePlaying() {
  return audio !== null
}
