// ── Custom MP3 player singleton ───────────────────────────────────────────────
// Works natively on iPad (Safari + Chrome) via the HTML5 Audio API.
// No DRM, no external SDK, no service workers.

import { supabase } from './supabase'

const BUCKET      = 'music'
const VOLUME_KEY  = 'pp_mp3_volume'
const SHUFFLE_KEY = 'pp_mp3_shuffle'
const LOOP_KEY    = 'pp_mp3_loop'

// ── Module-level state ────────────────────────────────────────────────────────
let audio        = null    // HTMLAudioElement (created lazily)
let playlist     = []      // [{ id, name, storage_path, duration, position }]
let currentIndex = -1
let isPlaying    = false
let volume       = parseInt(localStorage.getItem(VOLUME_KEY)  ?? '70', 10)
let shuffle      = localStorage.getItem(SHUFFLE_KEY) === 'true'
let loop         = localStorage.getItem(LOOP_KEY)    === 'true'

// ── Pub/sub ───────────────────────────────────────────────────────────────────
const listeners = new Set()

function emit(type, payload) {
  listeners.forEach(fn => { try { fn(type, payload) } catch {} })
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSnapshot() {
  return {
    song:        currentIndex >= 0 ? (playlist[currentIndex] ?? null) : null,
    playlist,
    currentIndex,
    isPlaying,
    volume,
    shuffle,
    loop,
    duration:    audio?.duration    ?? 0,
    currentTime: audio?.currentTime ?? 0,
  }
}

// ── Public URL for a storage path ─────────────────────────────────────────────
export function getSongUrl(storagePath) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}

// ── Audio element (lazy init) ─────────────────────────────────────────────────
function ensureAudio() {
  if (audio) return audio

  audio         = new Audio()
  audio.volume  = volume / 100
  audio.preload = 'auto'

  audio.addEventListener('ended', () => {
    const next = getNextIndex()
    if (next !== -1) {
      playSongAtIndex(next)
    } else {
      isPlaying = false
      emit('state', getSnapshot())
    }
  })

  audio.addEventListener('timeupdate', () => {
    emit('progress', getSnapshot())
  })

  audio.addEventListener('loadedmetadata', () => {
    emit('state', getSnapshot())
  })

  audio.addEventListener('error', () => {
    console.error('[AudioPlayer] Playback error on:', audio.src)
    isPlaying = false
    emit('state', getSnapshot())
    emit('error', 'Could not play this track. Ensure the file is a valid MP3.')
  })

  return audio
}

// ── Next / prev index ─────────────────────────────────────────────────────────
function getNextIndex() {
  if (playlist.length === 0) return -1
  if (shuffle) {
    if (playlist.length === 1) return loop ? 0 : -1
    let idx = Math.floor(Math.random() * playlist.length)
    if (idx === currentIndex) idx = (idx + 1) % playlist.length
    return idx
  }
  const next = currentIndex + 1
  if (next < playlist.length) return next
  return loop ? 0 : -1  // loop back to start when enabled
}

function getPrevIndex() {
  if (playlist.length === 0) return -1
  if (shuffle) {
    if (playlist.length === 1) return 0
    let idx = Math.floor(Math.random() * playlist.length)
    if (idx === currentIndex) idx = (idx - 1 + playlist.length) % playlist.length
    return idx
  }
  return Math.max(0, currentIndex - 1)
}

// ── Playback controls ─────────────────────────────────────────────────────────
export async function playSongAtIndex(index) {
  if (index < 0 || index >= playlist.length) return
  const song = playlist[index]
  const a    = ensureAudio()
  a.src      = getSongUrl(song.storage_path)
  a.load()
  try {
    await a.play()
    currentIndex = index
    isPlaying    = true
    emit('state', getSnapshot())
  } catch (err) {
    console.error('[AudioPlayer] Play error:', err.message)
    isPlaying = false
    emit('state', getSnapshot())
    emit('error', 'Playback failed: ' + err.message)
  }
}

export async function togglePlay() {
  const a = ensureAudio()
  if (isPlaying) {
    a.pause()
    isPlaying = false
    emit('state', getSnapshot())
  } else {
    if (currentIndex === -1 && playlist.length > 0) {
      await playSongAtIndex(0)
    } else if (currentIndex >= 0) {
      try {
        await a.play()
        isPlaying = true
        emit('state', getSnapshot())
      } catch (err) {
        emit('error', err.message)
      }
    }
  }
}

/**
 * Explicit pause that preserves the current track and currentTime so a
 * subsequent resume() picks up exactly where we left off. Used by external
 * orchestrators (e.g. the per-drill cue player) that need state-preserving
 * pause without the toggle semantics of togglePlay().
 *
 * Idempotent: no-op if already paused or if there is no current track.
 */
export function pause() {
  if (!isPlaying) return
  if (!audio) return
  audio.pause()
  isPlaying = false
  emit('state', getSnapshot())
}

/**
 * Resume the current track from its existing currentTime. Mirror of pause().
 * Idempotent: no-op if already playing or if there is no current track to
 * resume. Errors during play() are emitted via the 'error' channel exactly
 * like togglePlay().
 */
export async function resume() {
  if (isPlaying) return
  if (!audio) return
  if (currentIndex < 0) return
  try {
    await audio.play()
    isPlaying = true
    emit('state', getSnapshot())
  } catch (err) {
    emit('error', err.message)
  }
}

export async function playNext() {
  const next = getNextIndex()
  if (next !== -1) await playSongAtIndex(next)
}

export async function playPrev() {
  // Within first 3 seconds: restart current song; otherwise go to previous
  if (audio && audio.currentTime > 3 && !shuffle) {
    audio.currentTime = 0
    return
  }
  const prev = getPrevIndex()
  if (prev !== -1) await playSongAtIndex(prev)
}

export function setVolume(pct) {
  volume = Math.round(Math.max(0, Math.min(100, pct)))
  localStorage.setItem(VOLUME_KEY, String(volume))
  if (audio) audio.volume = volume / 100
  emit('state', getSnapshot())
}

export function setShuffle(on) {
  shuffle = !!on
  localStorage.setItem(SHUFFLE_KEY, String(shuffle))
  emit('state', getSnapshot())
}

export function setLoop(on) {
  loop = !!on
  localStorage.setItem(LOOP_KEY, String(loop))
  emit('state', getSnapshot())
}

export function seek(seconds) {
  if (!audio) return
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration ?? 0))
}

/** Update the player's playlist. Keeps the currently playing song stable by id. */
export function setPlaylist(songs) {
  if (currentIndex >= 0) {
    const currentId = playlist[currentIndex]?.id
    const newIdx    = songs.findIndex(s => s.id === currentId)
    currentIndex    = newIdx  // -1 if song was deleted
  }
  playlist = songs
  emit('state', getSnapshot())
}

// ── Volume ducking (air horn + speech chaining) ───────────────────────────────
let duckTimer  = null   // pending auto-restore setTimeout id
let duckedFrom = null   // volume% to restore to; null = not currently ducked

function doRestore() {
  if (duckedFrom === null) return
  volume     = duckedFrom
  duckedFrom = null
  if (audio) audio.volume = volume / 100
  emit('state', getSnapshot())
}

export async function duckForHorn(hornFn) {
  const shouldDuck = isPlaying && volume > 25

  if (shouldDuck) {
    duckedFrom = volume
    if (audio) audio.volume = 0.20
    // Cancel any in-flight restore from a previous duck so they don't stack
    if (duckTimer) { clearTimeout(duckTimer); duckTimer = null }
  }

  try { await hornFn() } catch {}

  if (shouldDuck) {
    // Schedule auto-restore; speakDrillName will cancel this via holdDuck()
    // and take over restoration via releaseDuck() when speech ends.
    duckTimer = setTimeout(() => { duckTimer = null; doRestore() }, 3000)
  }
}

/**
 * Cancel the pending auto-restore timer so the duck stays open.
 * Called by speakDrillName() on utterance.onstart — prevents the horn's
 * 3-second timer from popping music back up mid-sentence.
 */
export function holdDuck() {
  if (duckTimer) { clearTimeout(duckTimer); duckTimer = null }
}

/**
 * Restore music volume immediately.
 * Called by speakDrillName() on utterance.onend / utterance.onerror.
 */
export function releaseDuck() {
  if (duckTimer) { clearTimeout(duckTimer); duckTimer = null }
  doRestore()
}

/**
 * Start a fresh duck right now.
 * Called on utterance.onstart when the speech fires 10 s after the horn —
 * the horn's 3-second duck will have long since restored, so we need a
 * brand-new duck rather than extending an existing one.
 */
export function duckNow() {
  if (!isPlaying || volume <= 25) return
  if (duckTimer) { clearTimeout(duckTimer); duckTimer = null }
  duckedFrom = volume
  if (audio) audio.volume = 0   // silence music completely during speech announcement
}

// ── Stop & reset ──────────────────────────────────────────────────────────────
export function stop() {
  if (audio) {
    audio.pause()
    audio.src = ''
  }
  isPlaying    = false
  currentIndex = -1
  emit('state', getSnapshot())
}
