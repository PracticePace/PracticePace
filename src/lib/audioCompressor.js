// ── audioCompressor.js ────────────────────────────────────────────────────────
// Re-encode an uploaded audio file to 128 kbps mono MP3 before saving it to
// Supabase Storage. Used by the Music tab playlist upload to:
//   • Cut storage cost / bandwidth (typical 320 kbps stereo MP3 → 128 kbps
//     mono is roughly a 5× size reduction).
//   • Reduce decode load on the iPad during practice — the suspect for the
//     choppy audio coaches see while AirPlay-mirroring is the CPU cost of
//     decoding high-bitrate stereo on every track skip.
//
// Cues are NOT compressed (per spec): they're short, often already tight
// clips (horn loops, voice tags, etc.), and re-encoding short audio can
// introduce audible artifacts.
//
// IMPLEMENTATION
//   1. Read the File/Blob as an ArrayBuffer.
//   2. Decode via AudioContext.decodeAudioData → Float32 PCM at the
//      file's native sample rate. Browser decoders are fast and handle
//      every common format (MP3, M4A, AAC, WAV, OGG).
//   3. Down-mix to mono if stereo (simple average of L+R channels).
//   4. Convert Float32 [-1, 1] samples to Int16 PCM (lamejs's input
//      format).
//   5. Encode frame-by-frame at 128 kbps mono using lamejs.Mp3Encoder.
//      Process in 1152-sample MP3 frames; yield to the event loop
//      every ~50 frames so the UI thread can update the progress bar
//      and stays responsive (no Web Worker — kept main-thread for
//      simplicity; can upgrade later if iPad shows lag).
//   6. Return a fresh Blob (type audio/mpeg).
//
// On any error (corrupt input, unsupported format, etc.) the function
// throws. The Music-upload caller catches and falls back to uploading
// the original file untouched.

import lamejs from 'lamejs'

const SAMPLES_PER_FRAME  = 1152      // an MP3 frame
const TARGET_BITRATE_KBPS = 128
const PROGRESS_YIELD_INTERVAL = 50   // frames between event-loop yields

/**
 * Compress an audio File or Blob to 128 kbps mono MP3.
 *
 * @param {File|Blob} input — anything the browser's AudioContext can decode.
 * @param {object} [opts]
 * @param {(progress:number)=>void} [opts.onProgress] — called with values
 *        in [0, 1]. Use to drive a progress bar. May be called many times
 *        per second; debounce on the consumer side if needed.
 * @returns {Promise<Blob>} new Blob with type 'audio/mpeg'.
 *
 * Throws on decode error. Caller handles fallback.
 */
export async function compressToMp3Mono128(input, opts = {}) {
  const { onProgress } = opts
  const report = typeof onProgress === 'function'
    ? (p) => { try { onProgress(p) } catch {} }
    : () => {}

  if (!input) throw new Error('compressToMp3Mono128: no input')

  // 1. Read as ArrayBuffer
  const arrayBuffer = await input.arrayBuffer()
  report(0.05)

  // 2. Decode to PCM. Browsers all support AudioContext (Safari needs
  //    the webkit prefix). Using OfflineAudioContext would let us
  //    resample on decode but adds complexity; decodeAudioData at the
  //    file's native sample rate is fine for our needs.
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('compressToMp3Mono128: no AudioContext')
  // We do NOT need to .resume() — decodeAudioData works on a suspended
  // context. Avoids prompting for audio permission.
  const ctx = new Ctx()
  let audioBuffer
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    try { ctx.close() } catch {}
  }
  report(0.20)

  // 3. Down-mix to mono. Average L+R channels; if input is already
  //    mono, just reuse the single channel.
  const sampleRate = audioBuffer.sampleRate
  const totalSamples = audioBuffer.length
  let monoFloat
  if (audioBuffer.numberOfChannels === 1) {
    monoFloat = audioBuffer.getChannelData(0)
  } else {
    const ch0 = audioBuffer.getChannelData(0)
    const ch1 = audioBuffer.getChannelData(1)
    monoFloat = new Float32Array(totalSamples)
    for (let i = 0; i < totalSamples; i++) {
      monoFloat[i] = (ch0[i] + ch1[i]) * 0.5
    }
  }
  report(0.25)

  // 4. Convert Float32 [-1, 1] → Int16. lamejs wants 16-bit PCM input.
  //    Use multiply-by-32767 with clamp to avoid wraparound on +1.0 spikes.
  const int16 = new Int16Array(totalSamples)
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, monoFloat[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  report(0.30)

  // 5. Encode frame-by-frame
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, TARGET_BITRATE_KBPS)
  const chunks = []
  const totalFrames = Math.ceil(totalSamples / SAMPLES_PER_FRAME)

  for (let frame = 0; frame < totalFrames; frame++) {
    const start = frame * SAMPLES_PER_FRAME
    const end   = Math.min(start + SAMPLES_PER_FRAME, totalSamples)
    const buf   = int16.subarray(start, end)
    const mp3buf = encoder.encodeBuffer(buf)
    if (mp3buf.length > 0) chunks.push(mp3buf)

    // Yield to the event loop periodically so the UI thread can paint
    // the progress bar and the page stays responsive. Cooperative
    // multitasking — Web Worker would be cleaner but is out of scope.
    if (frame % PROGRESS_YIELD_INTERVAL === 0) {
      // Map encode progress [0, 1] into the slice [0.30, 0.98] of the
      // overall progress so decoder/downmix/encoder phases share the bar.
      const encodeFrac = frame / totalFrames
      report(0.30 + encodeFrac * 0.68)
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 0))
    }
  }

  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)
  report(1)

  // 6. Pack into a Blob. lamejs returns Uint8Array chunks — Blob
  //    accepts those directly.
  return new Blob(chunks, { type: 'audio/mpeg' })
}
