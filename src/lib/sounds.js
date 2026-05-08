// ── Shared audio engine ────────────────────────────────────────────────────────
// One AudioContext lives for the whole app session. Buffers are loaded once.

let _ctx = null
let _hornBuffer = null
let _bellBuffer = null

export function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
  return _ctx
}

export async function resumeCtx() {
  const ctx = getCtx()
  if (ctx.state === 'suspended') await ctx.resume()
  return ctx
}

// ── Air horn (MP3 file) ────────────────────────────────────────────────────────
export async function loadHorn() {
  try {
    const ctx = await resumeCtx()
    if (_hornBuffer) return
    const res = await fetch('/airhorn.mp3')
    const ab  = await res.arrayBuffer()
    _hornBuffer = await ctx.decodeAudioData(ab)
  } catch (e) { /* ignore */ }
}

export async function playAirHorn() {
  try {
    const ctx = await resumeCtx()
    if (!_hornBuffer) { await loadHorn() }
    if (!_hornBuffer) return
    const src  = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = 4.0
    src.buffer = _hornBuffer
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start(0)
  } catch (e) { /* ignore */ }
}

// ── Bell (MP3 file) ───────────────────────────────────────────────────────────
// Boxing-style opening-bell sample at /audio/bell.mp3. Used as the 0:30
// drill-end warning (replaces the old 1:00 whistle). Mirrors the
// loadHorn / playAirHorn pattern — fetch + decode once, cache the
// AudioBuffer, then play through a fresh BufferSourceNode each time.
// Previous implementation synthesized the bell via inharmonic
// oscillator partials; coaches preferred the warmer real recording.
export async function loadBell() {
  try {
    const ctx = await resumeCtx()
    if (_bellBuffer) return
    const res = await fetch('/audio/bell.mp3')
    const ab  = await res.arrayBuffer()
    _bellBuffer = await ctx.decodeAudioData(ab)
  } catch (e) { /* ignore */ }
}

export async function playBell() {
  try {
    const ctx = await resumeCtx()
    if (!_bellBuffer) { await loadBell() }
    if (!_bellBuffer) return
    const src  = ctx.createBufferSource()
    const gain = ctx.createGain()
    // 2.4× matches the previous synthesized bell's peak loudness so the
    // toggle behaviour is unchanged for coaches who already had it on.
    // Lower than the air horn's 4.0× because the bell is just a warning
    // cue, not the end-of-period blast.
    gain.gain.value = 2.4
    src.buffer = _bellBuffer
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start(0)
  } catch (e) { /* ignore */ }
}

// ── Whistle (synthesized) ─────────────────────────────────────────────────────
// Two short blasts — classic ref whistle. Retained for any future caller; the
// 1:00 drill warning was replaced by playBell() at the 0:30 mark.
export async function playWhistle() {
  try {
    const ctx = await resumeCtx()
    const blasts = 2
    for (let i = 0; i < blasts; i++) {
      const t    = ctx.currentTime + i * 0.28
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(2900, t)
      osc.frequency.linearRampToValueAtTime(3300, t + 0.06)
      osc.frequency.linearRampToValueAtTime(3000, t + 0.18)
      gain.gain.setValueAtTime(1.8, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.25)
    }
  } catch (e) { /* ignore */ }
}

// ── Stadium crowd roar (synthesized noise) ────────────────────────────────────
export async function playStadiumCrowd() {
  try {
    const ctx     = await resumeCtx()
    const dur     = 2.0
    const bufSize = Math.floor(ctx.sampleRate * dur)
    const buffer  = ctx.createBuffer(2, bufSize, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1
    }
    const src    = ctx.createBufferSource()
    src.buffer   = buffer
    const filter = ctx.createBiquadFilter()
    filter.type  = 'bandpass'
    filter.frequency.value = 700
    filter.Q.value = 0.4
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(3.5, ctx.currentTime + 0.3)
    gain.gain.linearRampToValueAtTime(3.5, ctx.currentTime + 1.5)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    src.start(ctx.currentTime)
    src.stop(ctx.currentTime + dur)
  } catch (e) { /* ignore */ }
}

// ── Period end buzzer (synthesized) ───────────────────────────────────────────
export async function playPeriodEnd() {
  try {
    const ctx = await resumeCtx()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(220, ctx.currentTime)
    osc.frequency.linearRampToValueAtTime(180, ctx.currentTime + 1.2)
    gain.gain.setValueAtTime(2.5, ctx.currentTime)
    gain.gain.setValueAtTime(2.5, ctx.currentTime + 0.9)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 1.4)
  } catch (e) { /* ignore */ }
}

// ── Drumline cadence (synthesized) ───────────────────────────────────────────
export async function playDrumline() {
  try {
    const ctx = await resumeCtx()
    // Pattern: BOOM tap tap BOOM tap tap BOOM tap
    const pattern = [
      { t: 0.00, bass: true },
      { t: 0.25, bass: false },
      { t: 0.50, bass: false },
      { t: 0.75, bass: true },
      { t: 1.00, bass: false },
      { t: 1.25, bass: false },
      { t: 1.50, bass: true },
      { t: 1.75, bass: false },
    ]
    pattern.forEach(({ t, bass }) => {
      const now = ctx.currentTime + t
      if (bass) {
        // Bass drum: sine with pitch drop
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(120, now)
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.12)
        gain.gain.setValueAtTime(4.0, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
        osc.connect(gain); gain.connect(ctx.destination)
        osc.start(now); osc.stop(now + 0.3)
      } else {
        // Snare: high noise burst
        const bufSize = Math.floor(ctx.sampleRate * 0.08)
        const buffer  = ctx.createBuffer(1, bufSize, ctx.sampleRate)
        const data    = buffer.getChannelData(0)
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1
        const src    = ctx.createBufferSource()
        src.buffer   = buffer
        const filter = ctx.createBiquadFilter()
        filter.type  = 'highpass'
        filter.frequency.value = 2000
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(1.8, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
        src.connect(filter); filter.connect(gain); gain.connect(ctx.destination)
        src.start(now); src.stop(now + 0.1)
      }
    })
  } catch (e) { /* ignore */ }
}

// ── Crowd clap rhythm (synthesized) ──────────────────────────────────────────
export async function playCrowdClap() {
  try {
    const ctx = await resumeCtx()
    // 4 rapid claps
    for (let i = 0; i < 4; i++) {
      const t       = ctx.currentTime + i * 0.22
      const bufSize = Math.floor(ctx.sampleRate * 0.06)
      const buffer  = ctx.createBuffer(1, bufSize, ctx.sampleRate)
      const data    = buffer.getChannelData(0)
      for (let j = 0; j < bufSize; j++) data[j] = Math.random() * 2 - 1
      const src    = ctx.createBufferSource()
      src.buffer   = buffer
      const filter = ctx.createBiquadFilter()
      filter.type  = 'bandpass'
      filter.frequency.value = 1400
      filter.Q.value = 0.8
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(2.2, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
      src.connect(filter); filter.connect(gain); gain.connect(ctx.destination)
      src.start(t); src.stop(t + 0.08)
    }
  } catch (e) { /* ignore */ }
}

// ── Auto-sound settings (localStorage) ───────────────────────────────────────
const SOUNDS_KEY = 'pp_auto_sounds'

export function getAutoSounds() {
  try {
    return JSON.parse(localStorage.getItem(SOUNDS_KEY) ?? '{}')
  } catch { return {} }
}

export function setAutoSound(key, value) {
  const current = getAutoSounds()
  localStorage.setItem(SOUNDS_KEY, JSON.stringify({ ...current, [key]: value }))
}
