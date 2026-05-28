// ─────────────────────────────────────────────────────────────────────────────
// WhiteboardImageLibraryDialog — per-program "bin" of named, reusable
// whiteboard images. Reads from public.whiteboard_images filtered by
// orgId (via RLS). Renders a responsive grid of thumbnails; tap one to
// set it as the active board background, tap the trash icon (and a
// confirm) to remove it from both the DB and Storage.
//
// "Upload new" doesn't own the upload flow itself — it just signals the
// parent (via onUploadNew) to fire its existing file picker, frame
// dialog, and name prompt. Keeps the upload pipeline DRY (one path,
// whether the coach went through the dropdown or the library).
//
// Layered modals: when the parent runs the upload flow it stacks
// WhiteboardImageFrameDialog and WhiteboardImageNameDialog over this
// library dialog (all use z-50 + fixed inset-0; latest-mounted wins
// the focus). On successful upload the parent calls reloadKey to nudge
// us to refetch, so the new thumbnail appears in the grid without the
// coach having to close + reopen the library.
//
// Role gating: the parent only mounts this dialog when canEdit is true,
// so by construction team_manager never sees Upload / Delete. If they
// could reach it through a URL, the DB RLS would still reject the
// delete and the storage RLS would reject any upload — defence in
// depth.
//
// PROPS
//   orgId          — required for the SELECT filter.
//   activeImageUrl — currently-active board URL (used to render a
//                    "currently shown" tag on the matching thumbnail).
//   orgColor       — primary-button + selected-thumbnail accent.
//   reloadKey      — bumped by the parent after a successful upload so
//                    we refetch the gallery.
//   onSelect(row)  — fires when the coach taps a thumbnail. Parent
//                    sets background = 'custom_image' + imageUrl =
//                    row.image_url and closes the dialog.
//   onUploadNew()  — fires when the coach taps the Upload new tile.
//                    Parent fires its file picker.
//   onDeleted(row) — fires after a successful row + storage delete so
//                    the parent can clear the active board if the
//                    deleted image was the one being shown.
//   onClose()      — fires when the coach taps Close. Parent unmounts
//                    this dialog without altering the active image.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)

const UploadIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

export default function WhiteboardImageLibraryDialog({
  orgId,
  activeImageUrl = null,
  orgColor       = '#cc1111',
  reloadKey      = 0,
  onSelect,
  onUploadNew,
  onDeleted,
  onClose,
}) {
  const [rows,           setRows]           = useState([])
  const [loading,        setLoading]        = useState(true)
  const [loadErr,        setLoadErr]        = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [deletingId,     setDeletingId]     = useState(null)
  const [deleteErr,      setDeleteErr]      = useState('')

  // Fetch on mount + whenever the parent bumps reloadKey (post-upload).
  useEffect(() => {
    if (!orgId) {
      setRows([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadErr('')
    ;(async () => {
      const { data, error } = await supabase
        .from('whiteboard_images')
        .select('id, name, image_url, storage_path, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('[WhiteboardImageLibrary] load error:', error.message)
        setLoadErr(error.message || 'Could not load image library')
        setRows([])
      } else {
        setRows(data ?? [])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [orgId, reloadKey])

  const pendingDeleteRow = useMemo(
    () => rows.find(r => r.id === pendingDeleteId) ?? null,
    [rows, pendingDeleteId]
  )

  async function runDelete(row) {
    setDeletingId(row.id)
    setDeleteErr('')
    try {
      // Row first, then storage file. If the row delete fails we keep
      // the image visible (no UI surprise); if the storage delete fails
      // afterward we have an orphan blob but the coach experience is
      // already clean (library no longer shows it).
      const { error: rowErr } = await supabase
        .from('whiteboard_images')
        .delete()
        .eq('id', row.id)
      if (rowErr) throw new Error(rowErr.message || 'Could not delete row')

      const { error: stoErr } = await supabase.storage
        .from('whiteboard-images')
        .remove([row.storage_path])
      if (stoErr) {
        // Non-fatal — log only. Library is already updated.
        console.warn('[WhiteboardImageLibrary] storage delete warning:',
                     stoErr.message ?? stoErr)
      }

      setRows(prev => prev.filter(r => r.id !== row.id))
      setPendingDeleteId(null)
      onDeleted?.(row)
    } catch (e) {
      console.error('[WhiteboardImageLibrary] delete failed:', e?.message ?? e)
      setDeleteErr(e?.message ?? 'Could not delete this image.')
    } finally {
      setDeletingId(null)
    }
  }

  function isActive(row) {
    return activeImageUrl && row.image_url === activeImageUrl
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl flex flex-col p-5 overflow-hidden"
        style={{
          backgroundColor: '#110000',
          border:          '1px solid #2a0000',
          maxHeight:       '92vh',
        }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-start justify-between gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-bold text-white text-lg">Image library</h3>
            <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
              Tap an image to use it as the whiteboard background. Upload
              new ones from your device — they stay saved for your
              program so you can switch between them later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="shrink-0 w-9 h-9 rounded-lg text-base flex items-center justify-center transition-colors"
            style={{
              backgroundColor: 'transparent',
              color:           '#c8a0a0',
              border:          '1px solid #3a1414',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body — scrollable grid */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm" style={{ color: '#9a8080' }}>Loading…</p>
            </div>
          )}

          {loadErr && !loading && (
            <p
              className="text-xs rounded-lg px-3 py-2 my-2"
              style={{ backgroundColor: '#2a0000', color: '#ff6666' }}
            >
              {loadErr}
            </p>
          )}

          {!loading && !loadErr && (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              }}
            >
              {/* Upload-new tile — always first, behaves like a
                  thumbnail-shaped button so it visually slots into the
                  grid even when the library is empty. */}
              <button
                type="button"
                onClick={onUploadNew}
                aria-label="Upload a new image"
                className="rounded-xl flex flex-col items-center justify-center gap-2 transition-colors"
                style={{
                  aspectRatio:     '4 / 3',
                  backgroundColor: '#0d0000',
                  border:          `1px dashed ${orgColor}88`,
                  color:           '#e8d8d8',
                }}
              >
                <UploadIcon />
                <span className="text-xs font-semibold uppercase tracking-widest">
                  Upload new
                </span>
              </button>

              {rows.map(row => {
                const active = isActive(row)
                const isDeleting = deletingId === row.id
                return (
                  <div
                    key={row.id}
                    className="rounded-xl overflow-hidden flex flex-col relative"
                    style={{
                      backgroundColor: '#0d0000',
                      border: active
                        ? `2px solid ${orgColor}`
                        : '1px solid #2a0000',
                      boxShadow: active ? `0 0 0 1px ${orgColor}55` : 'none',
                    }}
                  >
                    {/* Tap-target for selecting this image as the active
                        background. The whole thumbnail is the button;
                        the trash icon sits on top with its own onClick
                        and event.stopPropagation. */}
                    <button
                      type="button"
                      onClick={() => onSelect?.(row)}
                      aria-label={`Use "${row.name}" on the whiteboard`}
                      disabled={isDeleting}
                      className="block w-full text-left disabled:opacity-40"
                      style={{ aspectRatio: '4 / 3', overflow: 'hidden' }}
                    >
                      <img
                        src={row.image_url}
                        alt=""
                        className="w-full h-full"
                        style={{
                          objectFit:       'contain',
                          backgroundColor: '#ffffff',
                          display:         'block',
                        }}
                      />
                    </button>

                    {/* Name strip + trash */}
                    <div
                      className="flex items-center justify-between gap-2 px-2.5 py-2"
                      style={{ borderTop: '1px solid #2a0000' }}
                    >
                      <span
                        className="text-xs font-semibold truncate"
                        title={row.name}
                        style={{ color: '#e8d8d8' }}
                      >
                        {row.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(row.id)}
                        aria-label={`Delete "${row.name}"`}
                        title="Delete from library"
                        disabled={isDeleting}
                        className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-50"
                        style={{
                          backgroundColor: 'transparent',
                          color:           '#c8a0a0',
                          border:          '1px solid #3a1414',
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>

                    {active && (
                      <span
                        className="absolute top-1.5 left-1.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{
                          letterSpacing: '0.12em',
                          backgroundColor: orgColor,
                          color: '#ffffff',
                        }}
                      >
                        On board
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!loading && !loadErr && rows.length === 0 && (
            <p
              className="text-xs mt-3"
              style={{ color: '#7a6060' }}
            >
              No images yet — upload one to get started.
            </p>
          )}
        </div>

        {/* Inline delete-confirm overlay — small, no full-screen modal.
            Stays within the library dialog so the gallery context is
            preserved. Two buttons; clearly destructive on the right. */}
        {pendingDeleteRow && (
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-xl p-4 flex flex-col gap-3 shadow-2xl"
            style={{
              bottom: 24,
              minWidth: 300,
              backgroundColor: '#1a0000',
              border: `1px solid ${orgColor}`,
            }}
          >
            <p className="text-sm font-semibold text-white">
              Delete &ldquo;{pendingDeleteRow.name}&rdquo; from your library?
            </p>
            <p className="text-xs" style={{ color: '#9a8080' }}>
              The image will also be removed from the board if it&apos;s
              currently shown. This can&apos;t be undone.
            </p>
            {deleteErr && (
              <p
                className="text-xs rounded-lg px-2 py-1.5"
                style={{ backgroundColor: '#2a0000', color: '#ff6666' }}
              >
                {deleteErr}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setPendingDeleteId(null); setDeleteErr('') }}
                disabled={!!deletingId}
                className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#0d0000', color: '#c8a0a0', border: '1px solid #3a1414' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => runDelete(pendingDeleteRow)}
                disabled={!!deletingId}
                className="px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: orgColor }}
              >
                {deletingId ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
