import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import {
  subscribe as subscribeAudio, getSnapshot as getAudioSnapshot,
  playSongAtIndex, togglePlay, playNext, playPrev,
  setVolume as setAudioVolume, setShuffle, setLoop, setPlaylist, seek,
} from '../../lib/audioPlayer'
import { compressToMp3Mono128 } from '../../lib/audioCompressor'

const BUCKET = 'music'

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs || isNaN(secs)) return '—'
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function cleanName(filename) {
  return filename
    .replace(/\.(mp3|m4a|aac|wav|ogg|flac)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function measureDuration(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const a   = new Audio(url)
    a.addEventListener('loadedmetadata', () => { URL.revokeObjectURL(url); resolve(Math.round(a.duration)) })
    a.addEventListener('error',          () => { URL.revokeObjectURL(url); resolve(null) })
  })
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

const PlayIcon    = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
const PauseIcon   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
const SkipBack    = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
const SkipFwd     = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
const ShuffleIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" {...S}><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
const LoopIcon    = () => <svg width="16" height="16" viewBox="0 0 24 24" {...S}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
const UploadIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" {...S}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
const TrashIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" {...S}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
const DragHandle  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6a4040" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="17" x2="16" y2="17"/></svg>

// ── Player controls (always shown at top) ─────────────────────────────────────
function PlayerControls({ snap, currentTime, orgColor }) {
  const { song, isPlaying, volume, shuffle, loop, duration } = snap
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  const handleSeek = e => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(frac * duration)
  }

  return (
    <div className="flex flex-col gap-3 px-5 pt-5 pb-4 rounded-3xl"
      style={{ backgroundColor: '#0d0800', border: `1px solid ${orgColor}33` }}>

      {/* Song name */}
      <div className="min-w-0">
        <p className="font-bold text-white text-base truncate leading-tight">
          {song?.name ?? 'No song selected'}
        </p>
        <p className="text-xs mt-0.5" style={{ color: '#9a8080' }}>
          {song ? formatDuration(duration) : 'Upload songs below to get started'}
        </p>
      </div>

      {/* Progress bar */}
      <div
        className="relative h-2 rounded-full cursor-pointer"
        style={{ backgroundColor: '#2a1a00' }}
        onClick={handleSeek}
      >
        <div className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: orgColor }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white"
          style={{ left: `calc(${pct}% - 6px)`, backgroundColor: orgColor }} />
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-xs" style={{ color: '#6a4040', marginTop: -8 }}>
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(duration)}</span>
      </div>

      {/* Transport row */}
      <div className="flex items-center justify-center gap-4">
        {/* Shuffle */}
        <button onClick={() => setShuffle(!shuffle)}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
          style={{ color: shuffle ? orgColor : '#4a3030', backgroundColor: shuffle ? `${orgColor}22` : 'transparent' }}
          title="Shuffle">
          <ShuffleIcon />
        </button>

        {/* Prev */}
        <button onClick={playPrev}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{ backgroundColor: '#1a1000', color: '#fff' }}>
          <SkipBack />
        </button>

        {/* Play / Pause */}
        <button onClick={togglePlay}
          className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{ backgroundColor: orgColor, boxShadow: `0 0 28px ${orgColor}55` }}>
          {isPlaying
            ? <PauseIcon />
            : <span style={{ marginLeft: 3 }}><PlayIcon /></span>}
        </button>

        {/* Next */}
        <button onClick={playNext}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{ backgroundColor: '#1a1000', color: '#fff' }}>
          <SkipFwd />
        </button>

        {/* Loop */}
        <button onClick={() => setLoop(!loop)}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
          style={{ color: loop ? orgColor : '#4a3030', backgroundColor: loop ? `${orgColor}22` : 'transparent' }}
          title="Loop playlist">
          <LoopIcon />
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-3 px-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6a4040" strokeWidth="2" strokeLinecap="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        </svg>
        <input type="range" min={0} max={100} value={volume}
          onChange={e => setAudioVolume(Number(e.target.value))}
          className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${orgColor} ${volume}%, #2a1a00 ${volume}%)`,
            accentColor: orgColor,
          }}
        />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6a4040" strokeWidth="2" strokeLinecap="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      </div>
    </div>
  )
}

// ── Library tab ───────────────────────────────────────────────────────────────
function LibraryTab({ songs, playingId, orgColor, orgId, onRefresh }) {
  const fileInputRef  = useRef(null)
  const [uploads,     setUploads]    = useState([])
  const [delConfirm,  setDelConfirm] = useState(null)
  const [dragIdx,     setDragIdx]    = useState(null)
  const [dragOverIdx, setDragOverIdx]= useState(null)

  async function handleFiles(e) {
    const files = Array.from(e.target.files ?? []).filter(
      f => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg)$/i.test(f.name)
    )
    if (!files.length) return
    e.target.value = ''

    // Guard: org_id must be present before attempting any upload
    if (!orgId) {
      console.error('[Music] Upload blocked — orgId is null')
      setUploads([{ name: 'Upload failed', progress: 0, error: 'Not connected to an organization. Please refresh and try again.' }])
      return
    }

    console.log(`[Music] Starting upload of ${files.length} file(s) for org ${orgId}`)
    setUploads(files.map(f => ({
      name:     f.name,
      phase:    'pending',  // 'pending' | 'compressing' | 'uploading' | 'done'
      progress: 0,          // 0-100, meaning depends on phase
      error:    null,
    })))

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        // 1. Measure duration from local file before any encoding
        const duration = await measureDuration(file)
        console.log(`[Music] File ${i + 1}/${files.length}: "${file.name}" | duration: ${duration}s | size: ${file.size} bytes | type: ${file.type}`)

        // 2. Compress to 128 kbps mono before uploading. Reduces storage
        //    cost and (more importantly) the decode CPU cost on the iPad
        //    during AirPlay-mirrored practices. If compression fails for
        //    any reason — corrupt input, unsupported codec, etc. — fall
        //    back to uploading the original file untouched so the upload
        //    is never blocked by the compressor.
        setUploads(prev => prev.map((u, j) =>
          j === i ? { ...u, phase: 'compressing', progress: 0 } : u
        ))

        let toUpload = file
        let compressedOk = false
        try {
          const compressed = await compressToMp3Mono128(file, {
            onProgress: (p) => {
              setUploads(prev => prev.map((u, j) =>
                j === i ? { ...u, progress: Math.round(p * 100) } : u
              ))
            },
          })
          // Edge case: if the compressed output is somehow larger than
          // the source (already-low-bitrate file, very short file), upload
          // the original. Per the spec — compression should never make
          // the situation worse.
          if (compressed.size > 0 && compressed.size < file.size) {
            toUpload = compressed
            compressedOk = true
            console.log(`[Music] Compressed "${file.name}": ${file.size} → ${compressed.size} bytes (${Math.round(100 * compressed.size / file.size)}%)`)
          } else {
            console.log(`[Music] Skipping compression for "${file.name}" — compressed size ${compressed.size} >= original ${file.size}; uploading original.`)
          }
        } catch (compErr) {
          console.warn(`[Music] Compression failed for "${file.name}":`, compErr?.message ?? compErr, '→ falling back to original upload')
        }

        // 3. Build storage path — keep the original filename (spec'd).
        //    `_128` or similar suffix is intentionally NOT appended.
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path     = `${orgId}/${Date.now()}_${safeName}`
        console.log(`[Music] Uploading to storage path: ${path} (${compressedOk ? 'compressed' : 'original'})`)

        // 4. Upload to Supabase Storage. After compression the contentType
        //    is always audio/mpeg; on the fallback path we honour the
        //    original.
        setUploads(prev => prev.map((u, j) =>
          j === i ? { ...u, phase: 'uploading', progress: 0 } : u
        ))
        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, toUpload, {
            cacheControl: '3600',
            contentType:  compressedOk ? 'audio/mpeg' : (file.type || 'audio/mpeg'),
            upsert:       false,
          })

        if (uploadErr) {
          console.error('[Music] Storage upload failed:', uploadErr)
          throw new Error(uploadErr.message || JSON.stringify(uploadErr))
        }
        console.log(`[Music] Storage upload succeeded: ${path}`)

        // 5. Get the highest existing position so we can append
        const { data: maxRow } = await supabase
          .from('songs')
          .select('position')
          .eq('org_id', orgId)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle()

        const nextPos = (maxRow?.position ?? -1) + 1
        console.log(`[Music] Inserting song record at position ${nextPos}`)

        // 6. Insert the song record — check and surface any DB error
        const { error: insertErr } = await supabase.from('songs').insert({
          org_id:       orgId,
          name:         cleanName(file.name),
          storage_path: path,
          duration,
          position:     nextPos,
        })

        if (insertErr) {
          console.error('[Music] DB insert failed:', insertErr)
          // Storage file was uploaded but DB record failed — try to clean up
          await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
          throw new Error(insertErr.message || JSON.stringify(insertErr))
        }
        console.log(`[Music] Song record inserted OK: "${cleanName(file.name)}"`)

        setUploads(prev => prev.map((u, j) =>
          j === i ? { ...u, phase: 'done', progress: 100 } : u
        ))
      } catch (err) {
        const msg = err?.message ?? 'Unknown error'
        console.error(`[Music] Upload failed for "${file.name}":`, msg)
        setUploads(prev => prev.map((u, j) => j === i ? { ...u, error: msg } : u))
      }
    }

    await onRefresh()
    setTimeout(() => setUploads([]), 4000)
  }

  async function handleDelete(song) {
    try {
      await supabase.storage.from(BUCKET).remove([song.storage_path])
      await supabase.from('songs').delete().eq('id', song.id)
      setDelConfirm(null)
      await onRefresh()
    } catch (err) {
      console.error('[Music] Delete error:', err.message)
    }
  }

  async function onDrop(idx) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const reordered = [...songs]
    const [moved]   = reordered.splice(dragIdx, 1)
    reordered.splice(idx, 0, moved)
    setDragIdx(null); setDragOverIdx(null)
    setPlaylist(reordered)
    await Promise.all(reordered.map((s, i) => supabase.from('songs').update({ position: i }).eq('id', s.id)))
    await onRefresh()
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Upload button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-95"
        style={{ backgroundColor: '#1a0d00', border: `2px dashed ${orgColor}55`, color: orgColor }}>
        <UploadIcon /> Upload Music Files
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/m4a,audio/aac,audio/wav,audio/ogg,.mp3,.m4a,.aac,.wav"
        multiple
        className="hidden"
        onChange={handleFiles}
      />

      {/* Upload progress — three phases:
            'compressing' → 0-100% real progress (encoder reports it)
            'uploading'   → indeterminate (supabase-js v2 doesn't expose
                            byte progress)
            'done'        → ✓ Done
          Failed uploads keep the existing error UI. */}
      {uploads.length > 0 && (
        <div className="flex flex-col gap-2 px-1">
          {uploads.map((u, i) => {
            const status = u.error
              ? '✗ Failed'
              : u.phase === 'done'         ? '✓ Done'
              : u.phase === 'compressing'  ? `Compressing… ${u.progress}%`
              : u.phase === 'uploading'    ? 'Uploading…'
              :                              'Pending…'
            return (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex justify-between text-xs" style={{ color: u.error ? '#ff6666' : '#9a8080' }}>
                <span className="truncate max-w-[180px]">{cleanName(u.name)}</span>
                <span className="flex-shrink-0 ml-2">{status}</span>
              </div>
              {/* Actual error message on its own line */}
              {u.error && (
                <p className="text-xs leading-snug" style={{ color: '#ff6666' }}>
                  {u.error}
                </p>
              )}
              {!u.error && (
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#2a1a00' }}>
                  <div
                    className={`h-full rounded-full ${u.phase !== 'done' ? 'animate-pulse' : ''}`}
                    style={{
                      // Compressing → real percentage. Uploading → 60 %
                      // indeterminate. Done → 100 %.
                      width:
                        u.phase === 'done'        ? '100%'
                      : u.phase === 'compressing' ? `${Math.max(2, u.progress)}%`
                      :                             '60%',
                      backgroundColor: orgColor,
                    }}
                  />
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {songs.length === 0 && uploads.length === 0 && (
        <div className="text-center py-10" style={{ color: '#6a4040' }}>
          <p className="text-sm font-semibold">No songs yet</p>
          <p className="text-xs mt-1">Tap "Upload Music Files" to add MP3s for practice.</p>
        </div>
      )}

      {/* Song list */}
      {songs.length > 0 && (
        <div className="flex flex-col gap-1">
          {songs.map((song, idx) => {
            const isActive   = song.id === playingId
            const isDragOver = dragOverIdx === idx
            return (
              <div
                key={song.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(idx) }}
                onDrop={() => onDrop(idx)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all select-none"
                style={{
                  backgroundColor: isActive ? `${orgColor}22` : isDragOver ? '#2a1500' : '#0d0800',
                  border: `1px solid ${isActive ? orgColor + '55' : isDragOver ? orgColor + '44' : '#2a1a0033'}`,
                  cursor: 'grab',
                }}>

                <span className="flex-shrink-0 opacity-40"><DragHandle /></span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: isActive ? orgColor : '#fff' }}>
                    {song.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#6a4040' }}>
                    {formatDuration(song.duration)}
                  </p>
                </div>

                <button
                  onClick={() => playSongAtIndex(idx)}
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                  style={{ backgroundColor: isActive ? orgColor : '#2a1200', color: '#fff' }}>
                  <PlayIcon />
                </button>

                {delConfirm === song.id ? (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => handleDelete(song)}
                      className="text-xs font-bold px-2 py-1 rounded-lg"
                      style={{ backgroundColor: '#cc2200', color: '#fff' }}>Delete</button>
                    <button onClick={() => setDelConfirm(null)}
                      className="text-xs px-2 py-1 rounded-lg"
                      style={{ backgroundColor: '#2a1200', color: '#9a8080' }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setDelConfirm(song.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 opacity-40 hover:opacity-100 transition-all active:scale-90"
                    style={{ color: '#ff4444' }}>
                    <TrashIcon />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Playlist tab ──────────────────────────────────────────────────────────────
function PlaylistTab({ songs, currentIndex, orgColor, onReorder }) {
  const [dragIdx,     setDragIdx]     = useState(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  async function onDrop(idx) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const reordered = [...songs]
    const [moved]   = reordered.splice(dragIdx, 1)
    reordered.splice(idx, 0, moved)
    setDragIdx(null); setDragOverIdx(null)
    await onReorder(reordered)
  }

  async function moveUp(idx) {
    if (idx === 0) return
    const r = [...songs];
    [r[idx - 1], r[idx]] = [r[idx], r[idx - 1]]
    await onReorder(r)
  }

  async function moveDown(idx) {
    if (idx === songs.length - 1) return
    const r = [...songs];
    [r[idx], r[idx + 1]] = [r[idx + 1], r[idx]]
    await onReorder(r)
  }

  if (songs.length === 0) {
    return (
      <div className="text-center py-10" style={{ color: '#6a4040' }}>
        <p className="text-sm">Upload songs in the Library tab to build your playlist.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => playSongAtIndex(0)}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-95"
        style={{ backgroundColor: orgColor, color: '#fff', boxShadow: `0 0 20px ${orgColor}44` }}>
        <PlayIcon /> Play All from Start
      </button>

      <p className="text-xs text-center" style={{ color: '#6a4040' }}>
        Drag to reorder · use ▲▼ on iPad
      </p>

      <div className="flex flex-col gap-1">
        {songs.map((song, idx) => {
          const isActive   = idx === currentIndex
          const isDragOver = dragOverIdx === idx
          return (
            <div
              key={song.id}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={e => { e.preventDefault(); setDragOverIdx(idx) }}
              onDrop={() => onDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
              className="flex items-center gap-2 px-3 py-3 rounded-2xl transition-all select-none"
              style={{
                backgroundColor: isActive ? `${orgColor}22` : isDragOver ? '#2a1500' : '#0d0800',
                border: `1px solid ${isActive ? orgColor + '55' : isDragOver ? orgColor + '44' : '#2a1a0033'}`,
                cursor: 'grab',
              }}>

              <span className="text-xs font-bold w-5 text-center flex-shrink-0"
                style={{ color: isActive ? orgColor : '#4a3030' }}>{idx + 1}</span>

              <span className="flex-shrink-0 opacity-30 hidden md:block"><DragHandle /></span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: isActive ? orgColor : '#fff' }}>
                  {song.name}
                </p>
                <p className="text-xs" style={{ color: '#6a4040' }}>{formatDuration(song.duration)}</p>
              </div>

              {/* Touch-friendly up/down (iPad) */}
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <button onClick={() => moveUp(idx)} disabled={idx === 0}
                  className="w-6 h-6 rounded flex items-center justify-center text-xs disabled:opacity-20 active:scale-90"
                  style={{ backgroundColor: '#2a1200', color: '#9a8080' }}>▲</button>
                <button onClick={() => moveDown(idx)} disabled={idx === songs.length - 1}
                  className="w-6 h-6 rounded flex items-center justify-center text-xs disabled:opacity-20 active:scale-90"
                  style={{ backgroundColor: '#2a1200', color: '#9a8080' }}>▼</button>
              </div>

              <button onClick={() => playSongAtIndex(idx)}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90"
                style={{ backgroundColor: isActive ? orgColor : '#2a1200', color: '#fff' }}>
                <PlayIcon />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main MP3 player ───────────────────────────────────────────────────────────
function Mp3Player({ orgColor }) {
  const { profile } = useAuth()
  const orgId = profile?.org_id

  const [snap,        setSnap]        = useState(() => getAudioSnapshot())
  const [currentTime, setCurrentTime] = useState(0)
  const [songs,       setSongs]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [tab,         setTab]         = useState('library')

  useEffect(() => {
    return subscribeAudio((type, payload) => {
      if (type === 'state')    setSnap({ ...payload })
      if (type === 'progress') setCurrentTime(payload.currentTime)
      if (type === 'error')    setError(payload)
    })
  }, [])

  const loadSongs = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    try {
      const { data, error: err } = await supabase
        .from('songs')
        .select('*')
        .eq('org_id', orgId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
      if (err) throw err
      const list = data ?? []
      setSongs(list)
      setPlaylist(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { loadSongs() }, [loadSongs])

  async function handleReorder(reordered) {
    setSongs(reordered)
    setPlaylist(reordered)
    await Promise.all(reordered.map((s, i) => supabase.from('songs').update({ position: i }).eq('id', s.id)))
    await loadSongs()
  }

  if (!orgId) {
    return (
      <div className="text-center py-10" style={{ color: '#9a8080' }}>
        <p className="text-sm">Sign in to an organization to use the music player.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">

      <PlayerControls snap={snap} currentTime={currentTime} orgColor={orgColor} />

      {error && (
        <p className="text-xs px-4 py-3 rounded-2xl" style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
          {error}
        </p>
      )}

      {/* Sub-tabs */}
      <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid #2a1a00' }}>
        {[['library', '🎵 Library'], ['playlist', '📋 Playlist']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-2 text-sm font-bold transition-colors"
            style={{
              backgroundColor: tab === t ? orgColor : 'transparent',
              color: tab === t ? '#fff' : '#6a4040',
            }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 gap-3">
          <div className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{ borderColor: orgColor, borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: '#9a8080' }}>Loading songs…</p>
        </div>
      ) : tab === 'library' ? (
        <LibraryTab
          songs={songs} playingId={snap.song?.id ?? null}
          orgColor={orgColor} orgId={orgId} onRefresh={loadSongs}
        />
      ) : (
        <PlaylistTab
          songs={songs} currentIndex={snap.currentIndex}
          orgColor={orgColor} onReorder={handleReorder}
        />
      )}
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────
export default function AudioSection({ orgColor }) {
  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-8">
      <div className="max-w-xl mx-auto flex flex-col gap-6">

        <div className="flex items-center gap-3">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke={orgColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <h2 className="font-black text-white text-xl">Music</h2>
        </div>

        <Mp3Player orgColor={orgColor} />

      </div>
    </div>
  )
}
