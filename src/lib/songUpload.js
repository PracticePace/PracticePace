// Shared song-upload helper — single source of truth for uploading an
// audio file into an org's music library. Extracted from AudioSection's
// LibraryTab so the Playlist detail view (Commit E) can reuse the same
// compression / storage / DB flow without copy-pasting it.
//
// The upload has real steps that all need to happen atomically-ish:
//   1. Measure duration from the local file (offscreen <audio>)
//   2. Compress to 128 kbps mono MP3 (with graceful fallback to original)
//   3. Upload the resulting blob to Supabase Storage (`music` bucket)
//   4. Fetch the current max `position` in the org's library
//   5. Insert the songs row with `position = maxPos + 1`
//   6. If (5) fails, delete the storage object we just uploaded so we
//      don't leak orphaned blobs
//
// Progress is reported via onProgress({phase, progress}), so a caller
// can drive a per-file progress bar. On failure the helper THROWS so
// the caller can decide whether to continue with the rest of a batch
// or bail out.

import { supabase } from './supabase'
import { compressToMp3Mono128 } from './audioCompressor'

export const MUSIC_BUCKET = 'music'

/**
 * Turn a filename into a human-friendly song name — strip extension,
 * collapse separators to spaces.
 */
export function cleanName(filename) {
  return filename
    .replace(/\.(mp3|m4a|aac|wav|ogg|flac)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Measure the duration (seconds, integer) of a local file. Returns null
 * if the file can't be decoded (rare for audio files but possible for
 * corrupt uploads). Uses an offscreen <audio> element and a temporary
 * object URL that's revoked after `loadedmetadata` / `error` fires.
 */
export async function measureDuration(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const a   = new Audio(url)
    a.addEventListener('loadedmetadata', () => { URL.revokeObjectURL(url); resolve(Math.round(a.duration)) })
    a.addEventListener('error',          () => { URL.revokeObjectURL(url); resolve(null) })
  })
}

/**
 * Upload a single audio file into the org's music library.
 *
 * @param {File} file
 * @param {object} opts
 * @param {string} opts.orgId
 * @param {(update: {phase: 'compressing'|'uploading', progress: number}) => void} [opts.onProgress]
 * @returns {Promise<object>} the newly-inserted songs row (with id)
 * @throws on storage or DB failure (with storage cleanup already attempted)
 */
export async function uploadSongToLibrary(file, { orgId, onProgress }) {
  if (!orgId) throw new Error('Not connected to an organization. Please refresh and try again.')

  // 1. Measure duration from local file BEFORE any encoding.
  const duration = await measureDuration(file)
  console.log(`[songUpload] "${file.name}" | duration: ${duration}s | size: ${file.size} bytes | type: ${file.type}`)

  // 2. Compress. Fall back to the original file on any error / when
  //    compression didn't actually shrink the file.
  onProgress?.({ phase: 'compressing', progress: 0 })
  let toUpload    = file
  let compressed  = false
  try {
    const output = await compressToMp3Mono128(file, {
      onProgress: p => onProgress?.({ phase: 'compressing', progress: Math.round(p * 100) }),
    })
    if (output.size > 0 && output.size < file.size) {
      toUpload   = output
      compressed = true
      console.log(`[songUpload] compressed "${file.name}": ${file.size} → ${output.size} bytes (${Math.round(100 * output.size / file.size)}%)`)
    } else {
      console.log(`[songUpload] skipping compression — output ${output.size} >= original ${file.size}`)
    }
  } catch (err) {
    console.warn(`[songUpload] compression failed for "${file.name}":`, err?.message ?? err, '→ using original')
  }

  // 3. Storage upload. Path keeps the original filename (spec'd).
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path     = `${orgId}/${Date.now()}_${safeName}`
  onProgress?.({ phase: 'uploading', progress: 0 })
  const { error: uploadErr } = await supabase.storage
    .from(MUSIC_BUCKET)
    .upload(path, toUpload, {
      cacheControl: '3600',
      contentType:  compressed ? 'audio/mpeg' : (file.type || 'audio/mpeg'),
      upsert:       false,
    })
  if (uploadErr) {
    console.error('[songUpload] storage upload failed:', uploadErr)
    throw new Error(uploadErr.message || JSON.stringify(uploadErr))
  }
  onProgress?.({ phase: 'uploading', progress: 100 })

  // 4. Fetch max position, append.
  const { data: maxRow } = await supabase
    .from('songs')
    .select('position')
    .eq('org_id', orgId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  // 5. Insert row and return it. On DB failure, clean up the storage
  //    object we uploaded so we don't leak an orphan blob.
  const { data: inserted, error: insertErr } = await supabase
    .from('songs')
    .insert({
      org_id:       orgId,
      name:         cleanName(file.name),
      storage_path: path,
      duration,
      position:     nextPos,
    })
    .select()
    .single()
  if (insertErr) {
    console.error('[songUpload] DB insert failed:', insertErr)
    await supabase.storage.from(MUSIC_BUCKET).remove([path]).catch(() => {})
    throw new Error(insertErr.message || JSON.stringify(insertErr))
  }

  return inserted
}
