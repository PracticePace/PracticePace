// Playlists tab (Commit B of the playlists feature arc).
//
// Coach-managed named playlists sourced from the org's song library.
// Empty state → list state → detail view flow, all in-place inside the
// Music tab (no routes). Reorder uses the same native HTML5 drag/drop
// pattern LibraryTab and QueueTab already use — zero new dependencies.
//
// Data model (from Commit A migration):
//   playlists       (id, org_id, name, created_by, created_at, updated_at)
//   playlist_songs  (id, playlist_id, song_id, org_id, position, created_at)
//   scripts.playlist_id → playlists.id  (wired in Commits C/D)
//
// Playback and script-assignment come later; this commit is UI-only.

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'

// Shared helpers copied from AudioSection so this file can stand alone
// (both files apply the same convention across the Music tab).
function formatDuration(secs) {
  if (!secs || isNaN(secs)) return '—'
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

const ChevronRight = () => <svg width="16" height="16" viewBox="0 0 24 24" {...S}><polyline points="9 6 15 12 9 18"/></svg>
const ChevronLeft  = () => <svg width="16" height="16" viewBox="0 0 24 24" {...S}><polyline points="15 6 9 12 15 18"/></svg>
const MoreIcon     = () => <svg width="18" height="18" viewBox="0 0 24 24" {...S}><circle cx="12" cy="5"  r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
const PlusIcon     = () => <svg width="16" height="16" viewBox="0 0 24 24" {...S}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
const XIcon        = () => <svg width="14" height="14" viewBox="0 0 24 24" {...S}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
const DragHandle   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6a4040" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
const LibraryEmpty = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" {...S} style={{ opacity: 0.35 }}>
    <path d="M9 18V5l12-2v13"/>
    <circle cx="6"  cy="18" r="3"/>
    <circle cx="18" cy="16" r="3"/>
  </svg>
)

// ── Aggregation helpers ─────────────────────────────────────────────────────
// Given raw arrays of playlists / playlist_songs / songs (as loaded in
// Mp3Player), compute per-playlist summaries (name, song_count, total
// duration) without an N+1 query. Pure — safe to memoize.
export function summarizePlaylists(playlists, playlistSongs, songs) {
  const songById = new Map(songs.map(s => [s.id, s]))
  const bucket   = new Map()
  for (const ps of playlistSongs) {
    if (!bucket.has(ps.playlist_id)) bucket.set(ps.playlist_id, { count: 0, secs: 0 })
    const b = bucket.get(ps.playlist_id)
    b.count += 1
    const song = songById.get(ps.song_id)
    if (song?.duration) b.secs += song.duration
  }
  return playlists.map(p => {
    const b = bucket.get(p.id) ?? { count: 0, secs: 0 }
    return { ...p, song_count: b.count, duration_secs: b.secs }
  })
}

// Given a specific playlist id, return the ordered list of song rows
// (joined + sorted by position) for the detail view.
export function songsForPlaylist(playlistId, playlistSongs, songs) {
  const songById = new Map(songs.map(s => [s.id, s]))
  return playlistSongs
    .filter(ps => ps.playlist_id === playlistId)
    .sort((a, b) => a.position - b.position)
    .map(ps => ({
      playlistSongId: ps.id,
      position:       ps.position,
      song:           songById.get(ps.song_id) ?? null,
    }))
    // Drop rows whose song was hard-deleted (RLS-consistent — song FK is
    // ON DELETE CASCADE, so this should be rare; kept as a safety belt).
    .filter(row => row.song !== null)
}

// ── PlaylistsTab (default export) ───────────────────────────────────────────
// Owns the list-vs-detail toggle. Everything else is state-lifted to the
// parent (Mp3Player) so multiple tabs stay in sync.
export default function PlaylistsTab({
  playlists,          // raw playlists rows from DB
  playlistSongs,      // raw playlist_songs rows from DB
  songs,              // raw songs rows from DB (the library)
  orgId,
  userId,             // profile.id for created_by on inserts
  orgColor,
  canEdit,
  onChange,           // () => refetch playlists + playlist_songs in parent
}) {
  const [detailId,       setDetailId]       = useState(null)
  const [showCreate,     setShowCreate]     = useState(false)

  const summaries = useMemo(
    () => summarizePlaylists(playlists, playlistSongs, songs),
    [playlists, playlistSongs, songs],
  )

  // If the currently-open playlist was deleted (from another window or a
  // menu action), drop back to the list view rather than showing a stale
  // header.
  useEffect(() => {
    if (detailId && !summaries.some(p => p.id === detailId)) setDetailId(null)
  }, [detailId, summaries])

  if (detailId) {
    return (
      <PlaylistDetail
        playlistId={detailId}
        playlists={summaries}
        playlistSongs={playlistSongs}
        songs={songs}
        orgId={orgId}
        orgColor={orgColor}
        canEdit={canEdit}
        onBack={() => setDetailId(null)}
        onChange={onChange}
      />
    )
  }

  if (summaries.length === 0) {
    return (
      <>
        <EmptyState orgColor={orgColor} canEdit={canEdit} onCreate={() => setShowCreate(true)} />
        {showCreate && (
          <CreatePlaylistModal
            orgId={orgId}
            userId={userId}
            orgColor={orgColor}
            onCancel={() => setShowCreate(false)}
            onCreated={id => { setShowCreate(false); onChange(); setDetailId(id) }}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-95"
          style={{ backgroundColor: orgColor }}
        >
          <PlusIcon /> Create Playlist
        </button>
      )}

      <div className="flex flex-col gap-2">
        {summaries.map(p => (
          <PlaylistListRow key={p.id} playlist={p} orgColor={orgColor} onOpen={() => setDetailId(p.id)} />
        ))}
      </div>

      {showCreate && (
        <CreatePlaylistModal
          orgId={orgId}
          userId={userId}
          orgColor={orgColor}
          onCancel={() => setShowCreate(false)}
          onCreated={id => { setShowCreate(false); onChange(); setDetailId(id) }}
        />
      )}
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────────────────────
function EmptyState({ orgColor, canEdit, onCreate }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-10 px-4">
      <div style={{ color: '#6a4040' }}><LibraryEmpty /></div>
      <h3 className="font-black text-white text-lg">Create Your First Playlist</h3>
      <p className="text-sm leading-relaxed max-w-xs" style={{ color: '#9a8080' }}>
        Playlists let you group songs by theme — warm-up, game day, cool
        down. Assign a playlist to a practice script so it plays
        automatically.
      </p>
      {canEdit && (
        <button
          onClick={onCreate}
          className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black uppercase text-white transition-all active:scale-95 mt-2"
          style={{ backgroundColor: orgColor, letterSpacing: '0.08em' }}
        >
          <PlusIcon /> Create Playlist
        </button>
      )}
    </div>
  )
}

// ── List row ────────────────────────────────────────────────────────────────
function PlaylistListRow({ playlist, orgColor, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all active:scale-[0.99] text-left"
      style={{ backgroundColor: '#0d0800', border: '1px solid #2a1a0033' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{playlist.name}</p>
        <p className="text-xs mt-0.5" style={{ color: '#6a4040' }}>
          {playlist.song_count} song{playlist.song_count === 1 ? '' : 's'}
          {playlist.duration_secs > 0 && <> · {formatDuration(playlist.duration_secs)}</>}
        </p>
      </div>
      <span style={{ color: orgColor, opacity: 0.7 }}><ChevronRight /></span>
    </button>
  )
}

// ── Playlist detail view ────────────────────────────────────────────────────
// Header (back / name / more-menu), song list with reorder + remove, and
// an Add Songs button that opens the picker. Rename and Delete modals
// live inside so they close cleanly when the detail view is exited.
function PlaylistDetail({
  playlistId, playlists, playlistSongs, songs, orgId, orgColor, canEdit,
  onBack, onChange,
}) {
  const playlist = playlists.find(p => p.id === playlistId)
  const rows     = useMemo(
    () => songsForPlaylist(playlistId, playlistSongs, songs),
    [playlistId, playlistSongs, songs],
  )

  const [showAdd,      setShowAdd]      = useState(false)
  const [showRename,   setShowRename]   = useState(false)
  const [showDelete,   setShowDelete]   = useState(false)
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [pendingRemove, setPendingRemove] = useState(null)  // playlistSongId
  const [dragIdx,      setDragIdx]      = useState(null)
  const [dragOverIdx,  setDragOverIdx]  = useState(null)
  const [err,          setErr]          = useState('')

  // Guard: if playlist disappeared (deleted elsewhere), bail out early —
  // the parent's useEffect will drop us back to the list.
  if (!playlist) return null

  // ── Reorder ────────────────────────────────────────────────────────────────
  // Native HTML5 drag/drop — same shape as LibraryTab (line 583-591). On
  // drop, splice locally then batch-update every affected row's position
  // in one round trip.
  async function onDrop(idx) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const reordered = [...rows]
    const [moved]   = reordered.splice(dragIdx, 1)
    reordered.splice(idx, 0, moved)
    setDragIdx(null); setDragOverIdx(null)
    // Optimistic: parent will refetch after the writes land, restoring
    // authoritative order if anything drifted.
    try {
      await Promise.all(reordered.map((r, i) =>
        supabase.from('playlist_songs').update({ position: i }).eq('id', r.playlistSongId)
      ))
      onChange()
    } catch (e) {
      setErr('Could not save the new order — ' + e.message)
    }
  }

  async function confirmRemove() {
    if (!pendingRemove) return
    const id = pendingRemove
    setPendingRemove(null)
    try {
      const { error } = await supabase.from('playlist_songs').delete().eq('id', id)
      if (error) throw error
      onChange()
    } catch (e) {
      setErr('Could not remove song — ' + e.message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-bold uppercase transition-opacity hover:opacity-80"
          style={{ color: '#9a8080', letterSpacing: '0.08em' }}
        >
          <ChevronLeft /> Back
        </button>
        <div className="flex-1 text-center min-w-0">
          <p className="text-base font-black text-white truncate px-2">{playlist.name}</p>
          <p className="text-xs mt-0.5" style={{ color: '#6a4040' }}>
            {playlist.song_count} song{playlist.song_count === 1 ? '' : 's'}
            {playlist.duration_secs > 0 && <> · {formatDuration(playlist.duration_secs)}</>}
          </p>
        </div>
        {canEdit ? (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
              style={{ color: '#9a8080' }}
              aria-label="Playlist actions"
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              // Overlay backdrop catches taps outside the menu to close it.
              // Menu itself lives above the backdrop's stacking context.
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-44 rounded-xl shadow-xl overflow-hidden z-20"
                  style={{ backgroundColor: '#1a0d00', border: '1px solid #3a2a10' }}
                >
                  <button
                    onClick={() => { setMenuOpen(false); setShowRename(true) }}
                    className="w-full px-4 py-3 text-left text-sm text-white hover:opacity-80 transition-opacity"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); setShowDelete(true) }}
                    className="w-full px-4 py-3 text-left text-sm hover:opacity-80 transition-opacity"
                    style={{ color: '#ff6666', borderTop: '1px solid #3a2a1055' }}
                  >
                    Delete Playlist
                  </button>
                </div>
              </>
            )}
          </div>
        ) : <div className="w-9" />}
      </div>

      {canEdit && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
          style={{ border: `2px solid ${orgColor}`, color: orgColor, backgroundColor: 'transparent' }}
        >
          <PlusIcon /> Add Songs
        </button>
      )}

      {err && (
        <p className="text-xs px-4 py-3 rounded-2xl" style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
          {err}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-3 py-10">
          <p className="text-sm" style={{ color: '#9a8080' }}>
            This playlist is empty. {canEdit && 'Click Add Songs to get started.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, idx) => {
            const isDragOver = dragOverIdx === idx
            return (
              <div
                key={row.playlistSongId}
                draggable={canEdit}
                onDragStart={() => canEdit && setDragIdx(idx)}
                onDragOver={e => { if (canEdit) { e.preventDefault(); setDragOverIdx(idx) } }}
                onDrop={() => canEdit && onDrop(idx)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all select-none"
                style={{
                  backgroundColor: isDragOver ? '#2a1500' : '#0d0800',
                  border:          `1px solid ${isDragOver ? orgColor + '44' : '#2a1a0033'}`,
                  cursor:          canEdit ? 'grab' : 'default',
                }}
              >
                {canEdit && <span className="flex-shrink-0 opacity-40"><DragHandle /></span>}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{row.song.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#6a4040' }}>
                    {formatDuration(row.song.duration)}
                  </p>
                </div>
                {canEdit && (
                  pendingRemove === row.playlistSongId ? (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={confirmRemove}
                        className="text-xs font-bold px-2 py-1 rounded-lg"
                        style={{ backgroundColor: '#cc2200', color: '#fff' }}>Remove</button>
                      <button onClick={() => setPendingRemove(null)}
                        className="text-xs px-2 py-1 rounded-lg"
                        style={{ backgroundColor: '#2a1200', color: '#9a8080' }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setPendingRemove(row.playlistSongId)}
                      aria-label="Remove from playlist"
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 opacity-40 hover:opacity-100 transition-all active:scale-90"
                      style={{ color: '#ff4444' }}
                    >
                      <XIcon />
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddSongsModal
          playlist={playlist}
          playlistSongs={playlistSongs}
          songs={songs}
          orgId={orgId}
          orgColor={orgColor}
          onCancel={() => setShowAdd(false)}
          onDone={() => { setShowAdd(false); onChange() }}
        />
      )}
      {showRename && (
        <RenamePlaylistModal
          playlist={playlist}
          orgColor={orgColor}
          onCancel={() => setShowRename(false)}
          onDone={() => { setShowRename(false); onChange() }}
        />
      )}
      {showDelete && (
        <DeletePlaylistConfirm
          playlist={playlist}
          onCancel={() => setShowDelete(false)}
          onDone={() => { setShowDelete(false); onChange(); onBack() }}
        />
      )}
    </div>
  )
}

// ── Create-playlist modal ───────────────────────────────────────────────────
export function CreatePlaylistModal({ orgId, userId, orgColor, onCancel, onCreated }) {
  const [name,    setName]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [err,     setErr]     = useState('')
  const inputRef              = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true); setErr('')
    try {
      // Include created_by only when we have a userId — insert would fail
      // if the column value doesn't satisfy the FK, and it's nullable.
      const payload = { name: trimmed, org_id: orgId }
      if (userId) payload.created_by = userId
      const { data, error } = await supabase.from('playlists').insert(payload).select('id').single()
      if (error) throw error
      onCreated(data.id)
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <ModalShell onBackdrop={onCancel}>
      <h3 className="font-bold text-white text-lg">Create Playlist</h3>
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Warm-Up Mix"
        maxLength={80}
        className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none"
        style={{ backgroundColor: '#1a0d00', border: '1px solid #3a2a10' }}
      />
      {err && <p className="text-xs" style={{ color: '#ff6666' }}>{err}</p>}
      <div className="flex gap-3">
        <button onClick={onCancel} disabled={saving}
          className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ border: '1px solid #2a0000', color: '#9a8080' }}>Cancel</button>
        <button onClick={submit} disabled={!name.trim() || saving}
          className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
          style={{ backgroundColor: orgColor }}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </ModalShell>
  )
}

// ── Rename-playlist modal ───────────────────────────────────────────────────
function RenamePlaylistModal({ playlist, orgColor, onCancel, onDone }) {
  const [name,   setName]   = useState(playlist.name)
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const inputRef            = useRef(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === playlist.name || saving) { onCancel(); return }
    setSaving(true); setErr('')
    try {
      const { error } = await supabase
        .from('playlists')
        .update({ name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', playlist.id)
      if (error) throw error
      onDone()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <ModalShell onBackdrop={onCancel}>
      <h3 className="font-bold text-white text-lg">Rename Playlist</h3>
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        maxLength={80}
        className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none"
        style={{ backgroundColor: '#1a0d00', border: '1px solid #3a2a10' }}
      />
      {err && <p className="text-xs" style={{ color: '#ff6666' }}>{err}</p>}
      <div className="flex gap-3">
        <button onClick={onCancel} disabled={saving}
          className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ border: '1px solid #2a0000', color: '#9a8080' }}>Cancel</button>
        <button onClick={submit} disabled={!name.trim() || saving}
          className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
          style={{ backgroundColor: orgColor }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </ModalShell>
  )
}

// ── Delete-playlist confirmation ────────────────────────────────────────────
function DeletePlaylistConfirm({ playlist, onCancel, onDone }) {
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  async function submit() {
    setSaving(true); setErr('')
    try {
      // playlist_songs cascade-delete via FK — no manual cleanup needed.
      // scripts.playlist_id ON DELETE SET NULL, so scripts using this
      // playlist just lose the assignment.
      const { error } = await supabase.from('playlists').delete().eq('id', playlist.id)
      if (error) throw error
      onDone()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <ModalShell onBackdrop={onCancel}>
      <h3 className="font-bold text-white text-lg">Delete this playlist?</h3>
      <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
        &ldquo;{playlist.name}&rdquo; will be removed. Songs stay in your
        library. Any scripts assigned to this playlist keep their
        settings but the playlist assignment clears.
      </p>
      {err && <p className="text-xs" style={{ color: '#ff6666' }}>{err}</p>}
      <div className="flex gap-3">
        <button onClick={onCancel} disabled={saving}
          className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ border: '1px solid #2a0000', color: '#9a8080' }}>Cancel</button>
        <button onClick={submit} disabled={saving}
          className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
          style={{ backgroundColor: '#cc1111' }}>
          {saving ? 'Deleting…' : 'Delete Playlist'}
        </button>
      </div>
    </ModalShell>
  )
}

// ── Add-songs modal ─────────────────────────────────────────────────────────
// Shows all library songs. Ones already in the playlist are visually
// muted with an "Added" pill and can't be selected. Selected songs get
// appended to the end of the playlist (position = current max + 1 …).
function AddSongsModal({ playlist, playlistSongs, songs, orgId, orgColor, onCancel, onDone }) {
  const [query,    setQuery]    = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState('')

  // Ids already in this playlist — for the muted/disabled state.
  const alreadyInIds = useMemo(
    () => new Set(playlistSongs.filter(ps => ps.playlist_id === playlist.id).map(ps => ps.song_id)),
    [playlistSongs, playlist.id],
  )
  const maxPos = useMemo(
    () => playlistSongs.filter(ps => ps.playlist_id === playlist.id).reduce((m, ps) => Math.max(m, ps.position), -1),
    [playlistSongs, playlist.id],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? songs.filter(s => s.name.toLowerCase().includes(q)) : songs
  }, [songs, query])

  function toggle(id) {
    if (alreadyInIds.has(id)) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function submit() {
    if (selected.size === 0 || saving) return
    setSaving(true); setErr('')
    try {
      const rows = [...selected].map((songId, i) => ({
        playlist_id: playlist.id,
        song_id:     songId,
        org_id:      orgId,
        position:    maxPos + 1 + i,
      }))
      const { error } = await supabase.from('playlist_songs').insert(rows)
      if (error) throw error
      onDone()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <ModalShell onBackdrop={onCancel} maxWidth="max-w-md">
      <h3 className="font-bold text-white text-lg">Add songs to &ldquo;{playlist.name}&rdquo;</h3>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter library…"
        className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none"
        style={{ backgroundColor: '#1a0d00', border: '1px solid #3a2a10' }}
      />
      <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <p className="text-sm text-center py-6" style={{ color: '#6a4040' }}>
            {songs.length === 0 ? 'Your library is empty. Upload songs first.' : 'No matches.'}
          </p>
        )}
        {filtered.map(song => {
          const already = alreadyInIds.has(song.id)
          const picked  = selected.has(song.id)
          return (
            <button
              key={song.id}
              onClick={() => toggle(song.id)}
              disabled={already}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left disabled:cursor-default"
              style={{
                backgroundColor: picked ? `${orgColor}22` : '#1a0d00',
                border:          `1px solid ${picked ? orgColor : '#2a1a0055'}`,
                opacity:         already ? 0.4 : 1,
              }}
            >
              <span aria-hidden="true"
                className="w-5 h-5 rounded-md shrink-0 flex items-center justify-center"
                style={{
                  backgroundColor: picked ? orgColor : 'transparent',
                  border:          `2px solid ${picked ? orgColor : (already ? '#3a2a10' : '#5a3030')}`,
                  color:           '#fff',
                  fontSize:        12,
                  lineHeight:      1,
                }}
              >
                {picked ? '✓' : ''}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{song.name}</p>
                <p className="text-xs mt-0.5" style={{ color: '#6a4040' }}>{formatDuration(song.duration)}</p>
              </div>
              {already && (
                <span className="text-[10px] font-bold uppercase tracking-widest shrink-0"
                  style={{ color: '#6a4040' }}>Added</span>
              )}
            </button>
          )
        })}
      </div>
      {err && <p className="text-xs" style={{ color: '#ff6666' }}>{err}</p>}
      <div className="flex gap-3">
        <button onClick={onCancel} disabled={saving}
          className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ border: '1px solid #2a0000', color: '#9a8080' }}>Cancel</button>
        <button onClick={submit} disabled={selected.size === 0 || saving}
          className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
          style={{ backgroundColor: orgColor }}>
          {saving ? 'Adding…' : `Add ${selected.size} song${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </ModalShell>
  )
}

// ── Add-to-playlist menu (used by LibraryTab rows) ──────────────────────────
// Small dropdown attached to a library song row's "..." button. Lists
// existing playlists (already-in ones muted); "+ New playlist" at bottom
// opens the Create modal, then adds this song to the new playlist.
export function AddToPlaylistMenu({
  songId, playlists, playlistSongs, orgId, userId, orgColor,
  onOpenChange, onChange,
}) {
  const [open,       setOpen]       = useState(false)
  const [creating,   setCreating]   = useState(false)
  const [err,        setErr]        = useState('')
  const [busy,       setBusy]       = useState(false)

  const summaries = useMemo(
    () => summarizePlaylists(playlists, playlistSongs, []),
    [playlists, playlistSongs],
  )
  // Which playlists already contain THIS song.
  const alreadyInIds = useMemo(
    () => new Set(playlistSongs.filter(ps => ps.song_id === songId).map(ps => ps.playlist_id)),
    [playlistSongs, songId],
  )

  function setOpenAndNotify(next) {
    setOpen(next)
    onOpenChange?.(next)
  }

  async function addTo(playlistId) {
    if (busy || alreadyInIds.has(playlistId)) return
    setBusy(true); setErr('')
    try {
      const maxPos = playlistSongs
        .filter(ps => ps.playlist_id === playlistId)
        .reduce((m, ps) => Math.max(m, ps.position), -1)
      const { error } = await supabase.from('playlist_songs').insert({
        playlist_id: playlistId,
        song_id:     songId,
        org_id:      orgId,
        position:    maxPos + 1,
      })
      if (error) throw error
      onChange()
      setOpenAndNotify(false)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function createAndAdd(newPlaylistId) {
    // Called by the CreatePlaylistModal after successful insert. Add
    // this song, then close everything.
    setCreating(false)
    onChange()   // parent refetches so newly-created playlist is in state
    try {
      const { error } = await supabase.from('playlist_songs').insert({
        playlist_id: newPlaylistId,
        song_id:     songId,
        org_id:      orgId,
        position:    0,
      })
      if (error) throw error
      onChange()
      setOpenAndNotify(false)
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpenAndNotify(!open)}
        aria-label="Add to playlist"
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 opacity-40 hover:opacity-100 transition-all active:scale-90"
        style={{ color: '#9a8080' }}
      >
        <MoreIcon />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpenAndNotify(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 rounded-xl shadow-xl overflow-hidden z-20"
            style={{ backgroundColor: '#1a0d00', border: '1px solid #3a2a10' }}
          >
            <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: '#6a4040', borderBottom: '1px solid #3a2a1055' }}>
              Add to playlist
            </div>
            <div className="max-h-64 overflow-y-auto">
              {summaries.length === 0 && (
                <p className="px-4 py-3 text-xs" style={{ color: '#6a4040' }}>
                  No playlists yet. Create one below.
                </p>
              )}
              {summaries.map(p => {
                const already = alreadyInIds.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => addTo(p.id)}
                    disabled={already || busy}
                    className="w-full px-4 py-2.5 text-left text-sm transition-opacity flex items-center justify-between gap-2"
                    style={{ color: already ? '#5a3030' : '#fff', opacity: already ? 0.7 : 1 }}
                  >
                    <span className="truncate">{p.name}</span>
                    {already && <span className="text-[10px] uppercase tracking-widest shrink-0" style={{ color: '#6a4040' }}>Added</span>}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setCreating(true)}
              className="w-full px-4 py-3 text-left text-sm font-semibold flex items-center gap-2"
              style={{ color: orgColor, borderTop: '1px solid #3a2a1055' }}
            >
              <PlusIcon /> New playlist…
            </button>
            {err && <p className="px-4 pb-3 text-xs" style={{ color: '#ff6666' }}>{err}</p>}
          </div>
        </>
      )}
      {creating && (
        <CreatePlaylistModal
          orgId={orgId}
          userId={userId}
          orgColor={orgColor}
          onCancel={() => setCreating(false)}
          onCreated={createAndAdd}
        />
      )}
    </>
  )
}

// ── Shared modal shell ──────────────────────────────────────────────────────
// Full-screen darkening backdrop + centered inner card. Backdrop click
// closes (via onBackdrop). Matches the End Practice / Restart Practice
// modal shape already established in PracticeSection.
function ModalShell({ children, onBackdrop, maxWidth = 'max-w-sm' }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onBackdrop}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`w-full ${maxWidth} rounded-2xl p-6 flex flex-col gap-4`}
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
      >
        {children}
      </div>
    </div>
  )
}
