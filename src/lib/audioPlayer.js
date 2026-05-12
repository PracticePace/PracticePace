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
// NOTE on optimistic state updates: in playSongAtIndex / togglePlay /
// resume below we set `isPlaying = true` and emit the snapshot BEFORE
// awaiting audio.play(). The previous order was post-await, which left a
// 100-500 ms window on iPad (network + decode) where observers saw
// isPlaying:false even though the user had clicked play. The per-drill
// cue orchestration reads getSnapshot() during that window when a drill
// transition happens close to a song change — if isPlaying came back
// false the cue skipped its audioPause() call and music played on top
// of the cue (the BUG 1 report). Setting the state optimistically and
// reverting if play() rejects closes the race without changing the
// audible behaviour (a failed play() emits 'error' and flips state
// back).
export async function playSongAtIndex(index) {
  if (index < 0 || index >= playlist.length) return
  const song = playlist[index]
  const a    = ensureAudio()
  a.src      = getSongUrl(song.storage_path)
  a.load()
  // Optimistic — see NOTE above.
  currentIndex = index
  isPlaying    = true
  console.log('[Audio] playSongAtIndex →', { index, songId: song?.id, name: song?.name })
  emit('state', getSnapshot())
  try {
    await a.play()
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
    console.log('[Audio] togglePlay → pausing (was playing)')
    a.pause()
    isPlaying = false
    emit('state', getSnapshot())
  } else {
    if (currentIndex === -1 && playlist.length > 0) {
      console.log('[Audio] togglePlay → starting playlist[0]')
      await playSongAtIndex(0)
    } else if (currentIndex >= 0) {
      // Optimistic — see NOTE above.
      isPlaying = true
      console.log('[Audio] togglePlay → resuming at currentIndex:', currentIndex)
      emit('state', getSnapshot())
      try {
        await a.play()
      } catch (err) {
        isPlaying = false
        emit('state', getSnapshot())
        emit('error', err.message)
      }
    } else {
      console.log('[Audio] togglePlay → no-op (currentIndex:', currentIndex, ', playlist length:', playlist.length, ')')
    }
  }
}

/**
 * Explicit pause that preserves the current track and currentTime so a
 * subsequent resume() picks up exactly where we left off. Used by external
 * orchestrators (e.g. the per-drill cue player) that need state-preserving
 * pause without the toggle semantics of togglePlay().
 *
 * Idempotent: calling pause() when already paused is a no-op on the audio
 * element. We DROPPED the previous `if (!isPlaying) return` guard so the
 * function still pauses the underlying audio element even if the module
 * bookkeeping has drifted out of sync — a defensive fix for BUG 1 (cue
 * not pausing music). The emit is gated so we only fire 'state' if
 * something actually changed.
 */
export function pause() {
  if (!audio) return
  const stateChanged = isPlaying || !audio.paused
  audio.pause()
  isPlaying = false
  console.log('[Audio] pause() → stateChanged:', stateChanged, 'audio.paused now:', audio.paused)
  if (stateChanged) emit('state', getSnapshot())
}

/**
 * Resume the current track from its existing currentTime. Mirror of pause().
 * Idempotent: no-op if already playing or if there is no current track to
 * resume. Errors during play() are emitted via the 'error' channel exactly
 * like togglePlay().
 */
export async function resume() {
  if (isPlaying && audio && !audio.paused) return
  if (!audio) return
  if (currentIndex < 0) return
  // Optimistic — see NOTE on playSongAtIndex above.
  isPlaying = true
  console.log('[Audio] resume() → currentIndex:', currentIndex)
  emit('state', getSnapshot())
  try {
    await audio.play()
  } catch (err) {
    isPlaying = false
    emit('state', getSnapshot())
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
  const beforeIdx = currentIndex
  const beforeId  = currentIndex >= 0 ? playlist[currentIndex]?.id : null
  if (currentIndex >= 0) {
    const currentId = playlist[currentIndex]?.id
    const newIdx    = songs.findIndex(s => s.id === currentId)
    currentIndex    = newIdx  // -1 if song was deleted
  }
  playlist = songs
  console.log('[Audio] setPlaylist →',
    { beforeIdx, beforeId, afterIdx: currentIndex, listSize: songs.length, isPlaying, paused: audio?.paused ?? null })
  emit('state', getSnapshot())
}

// ── Volume ducking (air horn) ─────────────────────────────────────────────────
// Lowers the music to 20% while the horn fires, then auto-restores 3 s
// later. Previously this also coordinated with the drill-announcement TTS
// (holdDuck / releaseDuck / duckNow exports) — that feature was removed
// because iOS Safari couldn't AirPlay the speech to a mirrored Apple TV.
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
    // Auto-restore 3 s after the horn fires.
    duckTimer = setTimeout(() => { duckTimer = null; doRestore() }, 3000)
  }
}

// ── Stop & reset ──────────────────────────────────────────────────────────────
export function stop() {
  // [BUG 2 diagnostic] Log a stack trace so we can identify the caller if
  // music ever resets unexpectedly on navigation. The expected callers are
  // ONLY the bulk-delete batch in AudioSection (and only when the currently
  // playing song is in the batch). Any other call site is a bug.
  console.log('[Audio] stop() called — stack:', new Error().stack)
  if (audio) {
    audio.pause()
    audio.src = ''
  }
  isPlaying    = false
  currentIndex = -1
  emit('state', getSnapshot())
}
