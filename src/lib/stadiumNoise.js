// ── Stadium noise singleton ──────────────────────────────────────────────────
// Plays /audio/stadium_noise.mp3 on infinite loop at maximum volume. Independent
// of the music player and the practice timer — does NOT participate in horn
// ducking, voice ducking, or any other audio-mixing logic. Only the user
// tapping the toggle button starts or stops it.
//
// Pattern mirrors src/lib/audioPlayer.js but stripped down to the minimum:
// one source, no playlist, no progress, no shuffle/loop preference. Just
// start, stop, isPlaying, and a subscribe() so the toggle button can react
// to state changes from anywhere (including audio errors).

const SRC = '/audio/stadium_noise.mp3'

let audio     = null   // HTMLAudioElement (lazy)
let isPlaying = false

const listeners = new Set()

function emit() {
  const snap = getSnapshot()
  listeners.forEach(fn => { try { fn(snap) } catch {} })
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSnapshot() {
  return { isPlaying }
}

function ensureAudio() {
  if (audio) return audio
  audio          = new Audio(SRC)
  audio.loop     = true
  audio.volume   = 1.0
  audio.preload  = 'auto'

  audio.addEventListener('error', () => {
    console.error('[StadiumNoise] Playback error on:', audio?.src)
    isPlaying = false
    emit()
  })

  // If the audio stops for any reason (browser suspended it, network blip,
  // etc.), surface that in the snapshot so the button doesn't lie about state.
  audio.addEventListener('pause', () => {
    if (isPlaying && audio.ended === false) {
      // Treat any unexpected pause as "stopped" so the UI re-syncs.
      isPlaying = false
      emit()
    }
  })

  return audio
}

export async function start() {
  const a = ensureAudio()
  try {
    a.currentTime = 0
    await a.play()
    isPlaying = true
    emit()
  } catch (err) {
    console.error('[StadiumNoise] Play error:', err?.message ?? err)
    isPlaying = false
    emit()
  }
}

export function stop() {
  if (!audio) {
    isPlaying = false
    emit()
    return
  }
  audio.pause()
  audio.currentTime = 0
  isPlaying = false
  emit()
}

export async function toggle() {
  if (isPlaying) stop()
  else await start()
}
