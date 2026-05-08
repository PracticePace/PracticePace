// ── TTS via captured audio buffer (AirPlay-routing experiment) ───────────────
// EXPERIMENTAL. The bug we're trying to fix: when iPad mirrors to an Apple
// TV via AirPlay, every <audio>-element source (music, horn, bell, cue MP3)
// routes to the TV correctly, but `window.speechSynthesis` drill
// announcements stay on the local iPad speaker. iOS Safari treats
// speechSynthesis as a separate audio path from <audio> elements for
// AirPlay routing.
//
// The hypothesis here: if we can CAPTURE the synthesized speech into an
// audio buffer (via MediaRecorder over a WebAudio graph) and then play
// that buffer through an <audio> element, iOS will route it through the
// same AirPlay-active session as music / horn / cue MP3 — fixing the bug
// transparently to callers.
//
// HONEST TECHNICAL CAVEAT: as far as the public Web Audio + Web Speech
// API surface goes, there is NO documented way to connect a
// SpeechSynthesisUtterance into an AudioContext graph. The synthesized
// audio is rendered by the OS native TTS engine outside the page's audio
// graph. So a MediaRecorder over MediaStreamAudioDestinationNode will
// most likely capture only the silence-or-oscillator that we've put on
// the graph — i.e. an empty/silent blob. We attempt anyway because (a)
// the user explicitly authorised an exploratory attempt, (b) the
// diagnostic logs will tell us in one test run whether we're getting
// real captured audio or empty blobs, and (c) on the small chance some
// WebKit implementation does internally route speechSynthesis through
// the audio graph, this helper will pick it up for free.
//
// CRITICAL FALLBACK: if the capture step fails for ANY reason
// (MediaRecorder unsupported, AudioContext unavailable, capture timeout,
// 0-byte blob, audio element play() rejection, anything), the helper
// falls back to a regular `window.speechSynthesis.speak()` so the
// announcement still plays — even if it remains stuck on the local
// iPad speaker. We never silent-fail.

// Hard limit on how long we'll wait for the silent capture utterance to
// finish before aborting. Cuts the worst-case "delay before fallback
// fires" if the OS hangs the utterance for some reason.
const CAPTURE_TIMEOUT_MS = 4000

// Rate used on the SILENT capture utterance only. We crank it up so the
// failed capture phase finishes fast (~half second instead of ~2s for
// a typical "Next up. Individual Crossover." line) — minimises the
// audible delay before the fallback path starts speaking. The actual
// playback rate (in the fallback path) uses the caller's `rate`.
const CAPTURE_UTTERANCE_RATE = 2

/**
 * Speak `text` through a captured audio buffer if possible, otherwise
 * fall back to window.speechSynthesis.speak().
 *
 * Options (all optional):
 *   rate    : number — caller-intended rate for the SPOKEN audio (used in
 *              fallback). Capture path uses CAPTURE_UTTERANCE_RATE.
 *   pitch   : number — passed through.
 *   volume  : number — playback volume on the captured <audio> element AND
 *              the fallback utterance. Defaults to 1.0.
 *   voice   : SpeechSynthesisVoice — passed through to both paths.
 *   onStart : () => void — called when audible playback begins (capture
 *              path: just before audio.play(); fallback: utterance.onstart).
 *   onEnd   : () => void — called when audible playback ends in either
 *              path. Always fires exactly once per call (or zero times
 *              on a hard error before any audible playback occurred).
 *
 * Resolves with { capturedAndPlayed: true|false } so callers / tests can
 * distinguish which path ran. Never rejects — even hard errors resolve
 * (with capturedAndPlayed:false) so the caller's awaited Promise won't
 * blow up the timer state.
 */
export async function speakViaAudio(text, opts = {}) {
  const { rate, pitch, volume, voice, onStart, onEnd } = opts

  console.log('[TTSAirPlay] starting capture for:', text)

  // ── Capture attempt ─────────────────────────────────────────────────────
  try {
    if (typeof window === 'undefined')                 throw new Error('no window')
    if (!window.speechSynthesis)                       throw new Error('no speechSynthesis')
    if (typeof MediaRecorder === 'undefined')          throw new Error('no MediaRecorder')

    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx)                                          throw new Error('no AudioContext')

    const ctx = new Ctx()
    if (ctx.state === 'suspended') {
      try { await ctx.resume() } catch {}
    }

    const dest = ctx.createMediaStreamDestination()

    // Silent oscillator routed at zero gain so the destination stream has
    // SOMETHING flowing through it — without an active source, some
    // browsers refuse to start MediaRecorder ("no audio track"). This is
    // a placeholder; the actual hope is that some implementation of
    // speechSynthesis hooks into the same audio graph and we'll capture
    // the speech alongside the silence. (It almost certainly won't on
    // iOS, but it's the cheapest thing to try.)
    const silentOsc  = ctx.createOscillator()
    const silentGain = ctx.createGain()
    silentGain.gain.value = 0
    silentOsc.connect(silentGain)
    silentGain.connect(dest)
    silentOsc.start()

    const recorder = new MediaRecorder(dest.stream)
    const chunks   = []
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recorder.start()

    // Speak with volume=0 so we DON'T get double audio — if the capture
    // works, we'll hear the captured blob; if it fails, the fallback
    // path will speak (audibly) with the caller's volume.
    const captureUtterance = new SpeechSynthesisUtterance(text)
    captureUtterance.rate   = CAPTURE_UTTERANCE_RATE
    if (typeof pitch === 'number') captureUtterance.pitch = pitch
    captureUtterance.volume = 0
    if (voice) captureUtterance.voice = voice

    await new Promise((resolve, reject) => {
      const tid = setTimeout(
        () => reject(new Error('capture utterance timeout')),
        CAPTURE_TIMEOUT_MS
      )
      captureUtterance.onend   = () => { clearTimeout(tid); resolve() }
      captureUtterance.onerror = (e) => {
        clearTimeout(tid)
        reject(new Error(`capture utterance error: ${e?.error ?? 'unknown'}`))
      }
      // iOS quirk: cancel any stuck queue before speaking
      try { window.speechSynthesis.cancel() } catch {}
      window.speechSynthesis.speak(captureUtterance)
    })

    // Stop the recorder and collect the blob
    await new Promise((resolve) => {
      recorder.onstop = resolve
      try { recorder.stop() } catch { resolve() }
    })
    try { silentOsc.stop() } catch {}
    try { ctx.close() } catch {}

    const blob = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' })
    console.log('[TTSAirPlay] capture finished, blob size:', blob.size, 'bytes, type:', blob.type)

    if (blob.size === 0) {
      throw new Error('captured blob is 0 bytes — speechSynthesis is not exposed to WebAudio on this platform')
    }

    // ── Play the captured blob through <audio> ────────────────────────────
    const url   = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = typeof volume === 'number' ? volume : 1.0

    const endedPromise = new Promise((resolve, reject) => {
      audio.onended = () => {
        console.log('[TTSAirPlay] audio ended')
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onerror = (e) => {
        console.error('[TTSAirPlay] audio element error:', e)
        URL.revokeObjectURL(url)
        reject(new Error('audio element error'))
      }
    })

    if (typeof onStart === 'function') { try { onStart() } catch {} }
    await audio.play()
    console.log('[TTSAirPlay] audio element play() resolved')
    await endedPromise
    if (typeof onEnd === 'function')   { try { onEnd()   } catch {} }

    return { capturedAndPlayed: true }

  } catch (err) {
    console.error(
      '[TTSAirPlay] capture path failed, falling back to speechSynthesis:',
      err?.message ?? err,
      err?.stack ?? '(no stack)',
    )
    // fall through to fallback below
  }

  // ── Fallback: regular window.speechSynthesis.speak() ──────────────────────
  console.log('[TTSAirPlay] using fallback: window.speechSynthesis.speak()')
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      // Truly nothing we can do — fire onEnd so caller's ducking releases.
      if (typeof onEnd === 'function') { try { onEnd() } catch {} }
      resolve({ capturedAndPlayed: false, error: 'no speechSynthesis' })
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)
    if (typeof rate   === 'number') utterance.rate   = rate
    if (typeof pitch  === 'number') utterance.pitch  = pitch
    utterance.volume = typeof volume === 'number' ? volume : 1.0
    if (voice) utterance.voice = voice

    let endedFired = false
    const fireEnd = () => {
      if (endedFired) return
      endedFired = true
      if (typeof onEnd === 'function') { try { onEnd() } catch {} }
    }

    utterance.onstart = () => {
      console.log('[TTSAirPlay] fallback utterance.onstart')
      if (typeof onStart === 'function') { try { onStart() } catch {} }
    }
    utterance.onend = () => {
      console.log('[TTSAirPlay] fallback utterance.onend')
      fireEnd()
      resolve({ capturedAndPlayed: false })
    }
    utterance.onerror = (e) => {
      console.error('[TTSAirPlay] fallback utterance.onerror:', e?.error ?? e)
      fireEnd()
      resolve({ capturedAndPlayed: false, error: e?.error ?? 'unknown' })
    }

    // iOS quirk again: cancel + small delay before speak()
    try { window.speechSynthesis.cancel() } catch {}
    setTimeout(() => {
      try { window.speechSynthesis.speak(utterance) }
      catch (err) {
        console.error('[TTSAirPlay] fallback speak() threw:', err)
        fireEnd()
        resolve({ capturedAndPlayed: false, error: 'speak() threw' })
      }
    }, 50)
  })
}
