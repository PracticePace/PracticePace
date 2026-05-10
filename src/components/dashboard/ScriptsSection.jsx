import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { saveGuestScript, deleteGuestScript } from '../../lib/guestStorage'
import { playCue, stopCue } from '../../lib/cuePlayer'

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }
function fmt(s) { const sec = Number(s) || 0; return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}` }
function totalSec(drills) { return (drills ?? []).reduce((s, d) => s + (Number(d.duration) || 0), 0) }

const SPORTS = [
  { value: 'football',   label: 'Football' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'volleyball', label: 'Volleyball' },
  { value: 'baseball',   label: 'Baseball' },
  { value: 'softball',   label: 'Softball' },
  { value: 'soccer',     label: 'Soccer' },
  { value: 'track',      label: 'Track' },
  { value: 'wrestling',  label: 'Wrestling' },
  { value: 'tennis',     label: 'Tennis' },
  { value: 'other',      label: 'Other' },
]

const INPUT_STYLE = { backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#fff' }

// ── useDragReorder ────────────────────────────────────────────────────────────
// Touch + mouse drag-to-reorder hook. Works on iOS Safari / iPad.
function useDragReorder(items, onChange) {
  const dragIdx  = useRef(null)
  const overIdx  = useRef(null)
  const rowRefs  = useRef([])
  const [dragging, setDragging] = useState(null)   // index being dragged
  const [over,     setOver]     = useState(null)    // index being hovered

  // Compute which row the pointer is closest to
  function resolveOver(clientY) {
    const refs = rowRefs.current
    for (let i = 0; i < refs.length; i++) {
      const el = refs[i]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return i
    }
    return refs.length - 1
  }

  function startDrag(index) {
    dragIdx.current = index
    overIdx.current = index
    setDragging(index)
    setOver(index)
  }

  const handleMove = useCallback((clientY) => {
    if (dragIdx.current === null) return
    const o = resolveOver(clientY)
    overIdx.current = o
    setOver(o)
  }, [])

  const handleEnd = useCallback(() => {
    const from = dragIdx.current
    const to   = overIdx.current
    if (from !== null && to !== null && from !== to) {
      const next = [...items]
      const [removed] = next.splice(from, 1)
      next.splice(to, 0, removed)
      onChange(next)
    }
    dragIdx.current = null
    overIdx.current = null
    setDragging(null)
    setOver(null)
  }, [items, onChange])

  // Document-level listeners so drag works even if pointer leaves the row
  useEffect(() => {
    function onTouchMove(e) {
      if (dragIdx.current === null) return
      e.preventDefault()  // prevent page scroll while dragging
      handleMove(e.touches[0].clientY)
    }
    function onTouchEnd() { if (dragIdx.current !== null) handleEnd() }
    function onMouseMove(e) { if (dragIdx.current !== null) handleMove(e.clientY) }
    function onMouseUp()    { if (dragIdx.current !== null) handleEnd() }

    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend',  onTouchEnd)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend',  onTouchEnd)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup',   onMouseUp)
    }
  }, [handleMove, handleEnd])

  return { dragging, over, rowRefs, startDrag }
}

// ── NewScriptDialog ───────────────────────────────────────────────────────────
// Minimal dialog: just name + sport, then opens editor immediately.
function NewScriptDialog({ orgColor, defaultSport, onCancel, onCreate }) {
  const [name,  setName]  = useState('')
  const [sport, setSport] = useState(defaultSport ?? 'football')

  function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onCreate({ name: name.trim(), sport, drills: [] })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}>
      <div className="w-full max-w-sm rounded-2xl flex flex-col"
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>
        <div className="px-6 py-5 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid #2a0000' }}>
          <h2 className="font-bold text-white text-xl">New Script</h2>
          <button onClick={onCancel}
            className="w-9 h-9 flex items-center justify-center rounded-lg"
            style={{ color: '#9a8080', backgroundColor: '#1a0000' }}>✕</button>
        </div>

        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: '#9a8080' }}>Script Name</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="Monday Offense"
              autoFocus
              className="rounded-lg px-4 py-3 text-sm outline-none"
              style={INPUT_STYLE} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: '#9a8080' }}>Sport</label>
            <select value={sport} onChange={e => setSport(e.target.value)}
              className="rounded-lg px-4 py-3 text-sm outline-none"
              style={INPUT_STYLE}>
              {SPORTS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel}
              className="flex-1 py-3 rounded-lg text-sm font-semibold"
              style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
              Cancel
            </button>
            <button type="submit" disabled={!name.trim()}
              className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: orgColor }}>
              Create & Edit
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── PrintScriptDialog (Feature 4) ─────────────────────────────────────────────
// Modal: asks for the practice start time, then opens a new browser window
// containing a print-friendly HTML rendering of the script (header band with
// program name + logo, table with Period / Time / Duration / Drill / Notes).
// Time column is auto-calculated cumulatively from the start time + each
// preceding drill's duration.
//
// The print window is a self-contained HTML document we write directly into
// a new window — no React, no app chrome. Auto-triggers window.print() on
// load, plus a visible Print button in case the auto-trigger is blocked.

function fmtClock12h(d) {
  const h24 = d.getHours()
  const m   = d.getMinutes()
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 || 12
  const mm  = String(m).padStart(2, '0')
  return `${h12}:${mm} ${ampm}`
}

// Parse a user-typed start time like "3:30 PM", "15:30", "3:30pm", "330 PM",
// "9 AM" → returns { hour:0..23, minute:0..59 } or null if unparseable.
function parseStartTime(input) {
  if (!input) return null
  const s = input.trim().toUpperCase().replace(/\s+/g, ' ')
  // 12-hour with optional space + AM/PM
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m) {
    let h = parseInt(m[1], 10), min = parseInt(m[2], 10)
    if (h < 1 || h > 12 || min > 59) return null
    if (m[3] === 'PM' && h !== 12) h += 12
    if (m[3] === 'AM' && h === 12) h = 0
    return { hour: h, minute: min }
  }
  // 12-hour with NO colon, e.g. "330 PM"
  m = s.match(/^(\d{1,2})(\d{2})\s*(AM|PM)$/)
  if (m) {
    let h = parseInt(m[1], 10), min = parseInt(m[2], 10)
    if (h < 1 || h > 12 || min > 59) return null
    if (m[3] === 'PM' && h !== 12) h += 12
    if (m[3] === 'AM' && h === 12) h = 0
    return { hour: h, minute: min }
  }
  // hour only with AM/PM, e.g. "9 AM"
  m = s.match(/^(\d{1,2})\s*(AM|PM)$/)
  if (m) {
    let h = parseInt(m[1], 10)
    if (h < 1 || h > 12) return null
    if (m[2] === 'PM' && h !== 12) h += 12
    if (m[2] === 'AM' && h === 12) h = 0
    return { hour: h, minute: 0 }
  }
  // 24-hour H:MM
  m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m) {
    const h = parseInt(m[1], 10), min = parseInt(m[2], 10)
    if (h > 23 || min > 59) return null
    return { hour: h, minute: min }
  }
  return null
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPrintHtml({ scriptName, drills, programName, programNameColor, programLogoUrl, startHour, startMinute }) {
  // Pre-compute time column cumulatively.
  const cursor = new Date()
  cursor.setHours(startHour, startMinute, 0, 0)

  const rows = drills.map((d, i) => {
    const time = fmtClock12h(cursor)
    cursor.setSeconds(cursor.getSeconds() + (Number(d.duration) || 0))
    const totalSeconds = Number(d.duration) || 0
    const minPart = Math.floor(totalSeconds / 60)
    const secPart = totalSeconds % 60
    const dur = secPart === 0
      ? `${minPart} min`
      : `${minPart}:${String(secPart).padStart(2, '0')}`
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="time">${escapeHtml(time)}</td>
        <td class="dur">${escapeHtml(dur)}</td>
        <td class="drill">${escapeHtml(d.name ?? '')}</td>
        <td class="notes">${escapeHtml(d.notes ?? '')}</td>
      </tr>`
  }).join('')

  const headerColor = programNameColor || '#000000'
  const logoTag = programLogoUrl
    ? `<img class="logo" src="${escapeHtml(programLogoUrl)}" alt="" />`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(programName || 'Practice')} — ${escapeHtml(scriptName || 'Script')}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Arial, sans-serif; color: #000; background: #fff; }
  .toolbar { padding: 12px 24px; background: #f3f3f3; border-bottom: 1px solid #ccc; display: flex; gap: 12px; align-items: center; }
  .toolbar button { padding: 8px 16px; font-size: 14px; cursor: pointer; }
  .sheet { padding: 24px 32px; }
  .header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    border: 2px solid #000;
    padding: 24px 32px;
    min-height: 140px;
    margin-bottom: 16px;
  }
  .program-name {
    font-family: 'Helvetica Neue', Arial Black, sans-serif;
    font-weight: 900;
    font-size: 42px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${escapeHtml(headerColor)};
    line-height: 1;
    text-align: center;
    grid-column: 1 / 2;
  }
  .program-name .script-name {
    display: block;
    margin-top: 10px;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 1px;
    color: #333;
  }
  .header .logo {
    grid-column: 2 / 3;
    max-height: 110px;
    max-width: 180px;
    object-fit: contain;
    justify-self: end;
  }
  /* table-layout: fixed makes the column widths below authoritative.
     The Notes column is left without an explicit width so it consumes
     all remaining horizontal space — coaches handwrite there. */
  table { width: 100%; border-collapse: collapse; font-size: 12pt; table-layout: fixed; }
  thead th {
    text-align: left;
    background: #1a1a1a;
    color: #fff;
    padding: 10px 12px;
    font-size: 11pt;
    text-transform: uppercase;
    letter-spacing: 1px;
    border: 1px solid #000;
  }
  tbody td {
    border: 1px solid #444;
    padding: 10px 12px;
    vertical-align: top;
    page-break-inside: avoid;
    /* Tall rows so the Notes column has vertical room for handwriting. */
    height: 0.7in;
  }
  tbody tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f6f6f6; }
  /* Narrow fixed widths on the metadata columns, leaving Notes to absorb
     all remaining horizontal space via table-layout: fixed. */
  .num   { width:  5%; text-align: center; font-weight: 700; }
  .time  { width: 10%; white-space: nowrap; font-weight: 700; }
  .dur   { width: 10%; white-space: nowrap; }
  /* Drill column displays UPPERCASE to match the rest of the app's
     drill-name treatment (the script editor list and the practice
     screen both show drill names in all caps regardless of how the
     coach typed them). text-transform is display-only — the underlying
     stored value is preserved exactly as entered. */
  .drill { width: 25%; font-weight: 700; word-wrap: break-word; text-transform: uppercase; letter-spacing: 0.5px; }
  .notes { /* width: auto — takes the remaining ~50% */
           color: #444; font-size: 11pt; word-wrap: break-word; }
  @media print {
    .toolbar { display: none; }
    .sheet { padding: 0; }
    @page { margin: 0.5in; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨 Print</button>
    <button onclick="window.close()">Close</button>
  </div>
  <div class="sheet">
    <div class="header">
      <div class="program-name">
        ${escapeHtml(programName || 'Practice')}
        <span class="script-name">${escapeHtml(scriptName || 'Script')}</span>
      </div>
      ${logoTag}
    </div>
    <table>
      <thead>
        <tr>
          <th class="num">Period</th>
          <th class="time">Time</th>
          <th class="dur">Duration</th>
          <th class="drill">Drill</th>
          <th class="notes">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
  <script>
    // Auto-trigger print after the document loads. The visible Print button
    // is the fallback for browsers that block scripted printing.
    window.addEventListener('load', () => {
      setTimeout(() => { try { window.print() } catch (e) {} }, 250)
    })
  <\/script>
</body>
</html>`
}

function PrintScriptDialog({ scriptName, drills, orgColor,
  programName, programNameColor, programLogoUrl, onClose }) {
  const [startTime, setStartTime] = useState('')
  const [error,     setError]     = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const parsed = parseStartTime(startTime)
    if (!parsed) {
      setError('Enter a time like "3:30 PM" or "15:30".')
      return
    }
    if (!drills || drills.length === 0) {
      setError('This script has no drills yet.')
      return
    }
    const html = buildPrintHtml({
      scriptName, drills, programName, programNameColor, programLogoUrl,
      startHour: parsed.hour, startMinute: parsed.minute,
    })
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (!w) {
      setError('Popup blocked — allow popups for practicepace.app and try again.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl flex flex-col gap-4 p-5"
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
      >
        <h2 className="font-black text-white text-lg">Print Script</h2>
        <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
          When does practice start? Times in the printout will be calculated
          from this and each drill's duration.
        </p>

        <input
          autoFocus
          value={startTime}
          onChange={e => { setStartTime(e.target.value); setError('') }}
          placeholder="e.g. 3:30 PM"
          className="rounded-lg px-4 py-3 text-sm outline-none"
          style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#fff' }}
        />

        {error && (
          <p className="text-xs rounded-lg px-3 py-2"
            style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
            Cancel
          </button>
          <button type="submit"
            className="px-4 py-2 rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: orgColor }}>
            Open Print View
          </button>
        </div>
      </form>
    </div>
  )
}

// ── CueControl ───────────────────────────────────────────────────────────────
// Shared widget for the "drill cue MP3" affordance used by both AddDrillForm
// and DrillRow's edit mode. Two visual states:
//
//   1. No cue:  "🎵 Add cue" button → opens an .mp3 file picker.
//   2. Has cue: filename pill + ▶ preview button + ✕ remove button.
//
// Upload contract: the cue file goes into the existing 'music' storage bucket
// with the path `${orgId}/cues/${Date.now()}_${safeName}.mp3`. The first
// path segment must equal the user's profiles.org_id so the music bucket
// RLS upload policy passes (it requires split_part(name,'/',1) = org_id).
//
// Guests don't have a Supabase session that can write to storage, so the
// control hides itself entirely when isGuest is true.
function CueControl({ cueUrl, onChange, orgColor, orgId, isGuest }) {
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState('')
  const inputRef = useRef(null)

  if (isGuest) return null

  const filename = (() => {
    if (!cueUrl) return ''
    try {
      const last = cueUrl.split('?')[0].split('/').pop() ?? ''
      // Strip the leading "<timestamp>_" we added on upload.
      return last.replace(/^\d+_/, '')
    } catch { return '' }
  })()

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-selecting the same file later
    if (!file) return

    if (!orgId) { setError('Organization not loaded yet.'); return }
    const isMp3 = /\.mp3$/i.test(file.name) || file.type === 'audio/mpeg'
    if (!isMp3)                       { setError('MP3 files only.');                 return }
    if (file.size > 10 * 1024 * 1024) { setError('Cue MP3 must be under 10 MB.');    return }

    setUploading(true); setError('')
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path     = `${orgId}/cues/${Date.now()}_${safeName}`

      const { error: upErr } = await supabase.storage
        .from('music')
        .upload(path, file, { cacheControl: '3600', contentType: 'audio/mpeg', upsert: false })

      if (upErr) {
        setError(`Upload failed: ${upErr.message ?? 'unknown error'}`)
        return
      }

      const { data: urlData } = supabase.storage.from('music').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) { setError('Could not get cue URL.'); return }

      // Cache-bust the URL so a re-upload to the same path (after remove +
      // re-add) doesn't serve a stale cached audio file.
      onChange(`${publicUrl}?v=${Date.now()}`)
    } catch (err) {
      setError(err.message ?? 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  function handleRemove() {
    stopCue()
    onChange('')
    setError('')
  }

  function handlePreview() {
    if (cueUrl) playCue(cueUrl)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,.mp3"
        onChange={handleFile}
        className="hidden"
      />
      {!cueUrl ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50"
          style={{ border: '1px dashed #3a0000', color: '#9a8080', backgroundColor: 'transparent' }}
        >
          {uploading ? '⟳ Uploading…' : '🎵 Add cue'}
        </button>
      ) : (
        <>
          <span className="text-xs px-2 py-1 rounded-md max-w-[180px] truncate"
            style={{ backgroundColor: `${orgColor}22`, color: orgColor, border: `1px solid ${orgColor}44` }}
            title={filename}>
            🎵 {filename || 'cue'}
          </span>
          <button type="button" onClick={handlePreview}
            className="text-xs px-2 py-1 rounded-md"
            style={{ border: '1px solid #2a0000', color: '#9a8080', backgroundColor: 'transparent' }}
            title="Preview cue">
            ▶
          </button>
          <button type="button" onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2 py-1 rounded-md"
            style={{ border: '1px solid #2a0000', color: '#9a8080', backgroundColor: 'transparent' }}
            title="Replace cue">
            {uploading ? '⟳' : '↻'}
          </button>
          <button type="button" onClick={handleRemove}
            className="text-xs px-2 py-1 rounded-md"
            style={{ border: '1px solid #2a0000', color: '#6a3030', backgroundColor: 'transparent' }}
            title="Remove cue">
            ✕
          </button>
        </>
      )}
      {error && (
        <p className="text-xs w-full px-2 py-1 rounded-md"
          style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
          {error}
        </p>
      )}
    </div>
  )
}

// ── AddDrillForm ──────────────────────────────────────────────────────────────
// Persistent form at the bottom of the drill list. Owns its own state,
// reads values on Add click, calls onAdd(fields), then clears itself.
const DURATION_PRESETS = [5, 10, 15, 20]

function AddDrillForm({ orgColor, orgId, isGuest, onAdd }) {
  const [name,      setName]      = useState('')
  const [mins,      setMins]      = useState('')
  const [secs,      setSecs]      = useState('')
  const [notes,     setNotes]     = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [cueUrl,    setCueUrl]    = useState('')
  // Ref on the drill-name input so we can auto-focus on mount AND after
  // each add. On iPad, calling .focus() also raises the on-screen
  // keyboard. Means the coach can open the editor and immediately start
  // typing the first drill, then save and immediately type the next one
  // without tapping the field again.
  const nameInputRef = useRef(null)

  // Focus the name field when the form first appears.
  useEffect(() => {
    nameInputRef.current?.focus()
  }, [])

  const activePreset = (m) =>
    Number(mins) === m && (secs === '' || secs === '0' || Number(secs) === 0)

  // The "Show on practice screen" checkbox only makes sense when there's a
  // note to show; force it off whenever the notes field is empty.
  const hasNotes = notes.trim().length > 0
  const effectiveShowNotes = hasNotes && showNotes

  function handleAdd() {
    const drillName = name.trim()
    const duration  = Number(mins || 0) * 60 + Number(secs || 0)
    console.log('[AddDrill] name:', JSON.stringify(drillName), 'mins:', mins, 'secs:', secs, '→ duration (s):', duration)
    onAdd({
      name:        drillName,
      duration,
      notes:       notes.trim(),
      show_notes:  effectiveShowNotes,
      cue_mp3_url: cueUrl,
    })
    setName('')
    setMins('')
    setSecs('')
    setNotes('')
    setShowNotes(false)
    setCueUrl('')
    // Refocus so the next drill can be typed without tapping the field.
    nameInputRef.current?.focus()
  }

  return (
    <div className="rounded-xl p-3 flex flex-col gap-3 mt-1"
      style={{ border: `2px dashed ${orgColor}44`, backgroundColor: '#0d0000' }}>

      <input
        ref={nameInputRef}
        value={name} onChange={e => setName(e.target.value)}
        placeholder="Drill name..."
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleAdd() }}
        className="rounded-lg px-3 py-2.5 text-sm outline-none w-full"
        style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#fff' }} />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs shrink-0" style={{ color: '#9a8080' }}>Duration:</span>
        <input
          type="number" value={mins} min={0} placeholder="Min"
          onChange={e => setMins(e.target.value)}
          className="w-16 rounded-lg px-2 py-2 text-sm text-center outline-none"
          style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#fff' }} />
        <span className="text-xs" style={{ color: '#9a8080' }}>m</span>
        <input
          type="number" value={secs} min={0} max={59} placeholder="Sec"
          onChange={e => setSecs(e.target.value)}
          className="w-16 rounded-lg px-2 py-2 text-sm text-center outline-none"
          style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#fff' }} />
        <span className="text-xs" style={{ color: '#9a8080' }}>s</span>
        {DURATION_PRESETS.map(m => (
          <button key={m} type="button"
            onClick={() => { setMins(String(m)); setSecs('0') }}
            className="px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-80"
            style={{
              backgroundColor: activePreset(m) ? orgColor : '#2a0000',
              color:           activePreset(m) ? '#fff'    : '#9a8080',
              border: `1px solid ${activePreset(m) ? orgColor : '#3a0000'}`,
            }}>
            {m}m
          </button>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional) — coach reminders, focus points, etc."
        rows={2}
        className="rounded-lg px-3 py-2 text-xs outline-none w-full resize-y"
        style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#fff', minHeight: 48 }}
      />

      {/* Per-drill "show on practice screen" toggle. Only meaningful when
          there's a note; disabled (and visually muted) when notes is empty. */}
      <label
        className="flex items-center gap-2 text-xs select-none"
        style={{ color: hasNotes ? '#c8a0a0' : '#4a2020', cursor: hasNotes ? 'pointer' : 'not-allowed' }}
      >
        <input
          type="checkbox"
          checked={effectiveShowNotes}
          onChange={e => setShowNotes(e.target.checked)}
          disabled={!hasNotes}
          className="w-3.5 h-3.5"
          style={{ accentColor: orgColor }}
        />
        Show on practice screen
      </label>

      <CueControl
        cueUrl={cueUrl}
        onChange={setCueUrl}
        orgColor={orgColor}
        orgId={orgId}
        isGuest={isGuest}
      />

      <button onClick={handleAdd} disabled={!name.trim()}
        className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
        style={{ backgroundColor: orgColor }}>
        + Add Drill
      </button>
    </div>
  )
}

// ── DrillRow ──────────────────────────────────────────────────────────────────

function DrillRow({ drill, index, isEditing, isDragging, isOver, orgColor, orgId, isGuest,
  rowRef, onStartDrag, onEditStart, onEditSave, onEditCancel, onDelete }) {
  const [editName,      setEditName]      = useState(drill.name ?? '')
  const [editMins,      setEditMins]      = useState(drill.duration ? String(Math.floor(drill.duration / 60)) : '')
  const [editSecs,      setEditSecs]      = useState(drill.duration ? String(drill.duration % 60) : '')
  const [editNotes,     setEditNotes]     = useState(drill.notes ?? '')
  const [editShowNotes, setEditShowNotes] = useState(!!drill.show_notes)
  const [editCueUrl,    setEditCueUrl]    = useState(drill.cue_mp3_url ?? '')
  // Hover state — drives the +5% lightness lift on the row background
  // so the user knows the row is interactive. Pointer-only; touch
  // devices skip it (which is fine since edit/delete are explicit
  // buttons, not whole-row taps).
  const [isHover, setIsHover] = useState(false)

  // Sync edit fields when editing starts
  useEffect(() => {
    if (isEditing) {
      setEditName(drill.name ?? '')
      setEditMins(drill.duration ? String(Math.floor(drill.duration / 60)) : '')
      setEditSecs(drill.duration ? String(drill.duration % 60) : '')
      setEditNotes(drill.notes ?? '')
      setEditShowNotes(!!drill.show_notes)
      setEditCueUrl(drill.cue_mp3_url ?? '')
    }
  }, [isEditing, drill])

  const editHasNotes = editNotes.trim().length > 0
  const editEffectiveShowNotes = editHasNotes && editShowNotes

  // Tonal hierarchy on top of the dashboard's #0d0000 page bg:
  //   default row  : #1f0808  (~+10% L from page bg, lifts off the page)
  //   hover        : #281010  (+5% L on top of default — interactive cue)
  //   editing      : #2c1414  (lightest row + 2px orgColor outer ring)
  //   dragging     : #2a0808  (existing — drag-affordance shade) + 50% opacity
  // Borders are #3a1414 (~+20% L from row bg) by default, flip to
  // orgColor while another drill is being dragged OVER this row.
  // Edit-mode accent uses box-shadow (NOT border) so the layout
  // doesn't shift +1 px per side when a row enters edit mode.
  const rowStyle = {
    backgroundColor: isEditing  ? '#2c1414'
                   : isDragging ? '#2a0808'
                   : isHover    ? '#281010'
                   :              '#1f0808',
    border: `1px solid ${isOver && !isDragging ? orgColor + '88' : '#3a1414'}`,
    boxShadow: isEditing ? `0 0 0 2px ${orgColor}` : 'none',
    opacity: isDragging ? 0.5 : 1,
    transition: 'background-color 120ms, border-color 120ms, box-shadow 120ms',
    userSelect: 'none',
  }

  return (
    <div
      ref={rowRef}
      className="rounded-xl p-3 flex flex-col gap-2"
      style={rowStyle}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      {isEditing ? (
        // ── Inline edit mode ──────────────────────────────────────────────────
        <div className="flex flex-col gap-2">
          <input
            value={editName} onChange={e => setEditName(e.target.value)}
            placeholder="Drill name..." autoFocus
            className="rounded-lg px-3 py-2.5 text-sm outline-none w-full"
            style={{ backgroundColor: '#0d0000', border: '1px solid #3a0000', color: '#fff' }} />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs shrink-0" style={{ color: '#9a8080' }}>Duration:</span>
            <input type="number" value={editMins} min={0} placeholder="Min"
              onChange={e => setEditMins(e.target.value)}
              className="w-16 rounded-lg px-2 py-2 text-sm text-center outline-none"
              style={{ backgroundColor: '#0d0000', border: '1px solid #3a0000', color: '#fff' }} />
            <span className="text-xs" style={{ color: '#9a8080' }}>m</span>
            <input type="number" value={editSecs} min={0} max={59} placeholder="Sec"
              onChange={e => setEditSecs(e.target.value)}
              className="w-16 rounded-lg px-2 py-2 text-sm text-center outline-none"
              style={{ backgroundColor: '#0d0000', border: '1px solid #3a0000', color: '#fff' }} />
            <span className="text-xs" style={{ color: '#9a8080' }}>s</span>
            {/* Duration hot buttons */}
            {DURATION_PRESETS.map(m => (
              <button key={m} type="button"
                onClick={() => { setEditMins(String(m)); setEditSecs('0') }}
                className="px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: Number(editMins) === m && (editSecs === '0' || editSecs === 0)
                    ? orgColor : '#2a0000',
                  color: Number(editMins) === m && (editSecs === '0' || editSecs === 0)
                    ? '#fff' : '#9a8080',
                  border: `1px solid ${Number(editMins) === m && (editSecs === '0' || editSecs === 0)
                    ? orgColor : '#3a0000'}`,
                }}>
                {m}m
              </button>
            ))}
          </div>
          <textarea
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            placeholder="Notes (optional) — coach reminders, focus points, etc."
            rows={2}
            className="rounded-lg px-3 py-2 text-xs outline-none w-full resize-y"
            style={{ backgroundColor: '#0d0000', border: '1px solid #3a0000', color: '#fff', minHeight: 48 }}
          />
          {/* Per-drill "show on practice screen" toggle. Only meaningful when
              there's a note; disabled (and visually muted) when notes is empty. */}
          <label
            className="flex items-center gap-2 text-xs select-none"
            style={{ color: editHasNotes ? '#c8a0a0' : '#4a2020', cursor: editHasNotes ? 'pointer' : 'not-allowed' }}
          >
            <input
              type="checkbox"
              checked={editEffectiveShowNotes}
              onChange={e => setEditShowNotes(e.target.checked)}
              disabled={!editHasNotes}
              className="w-3.5 h-3.5"
              style={{ accentColor: orgColor }}
            />
            Show on practice screen
          </label>

          <CueControl
            cueUrl={editCueUrl}
            onChange={setEditCueUrl}
            orgColor={orgColor}
            orgId={orgId}
            isGuest={isGuest}
          />

          <div className="flex gap-2 justify-end">
            <button onClick={onEditCancel}
              className="px-3 py-2 rounded-lg text-xs font-semibold"
              style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
              Cancel
            </button>
            <button
              onClick={() => onEditSave(index, {
                name:        editName.trim(),
                duration:    Number(editMins || 0) * 60 + Number(editSecs || 0),
                notes:       editNotes.trim(),
                show_notes:  editEffectiveShowNotes,
                cue_mp3_url: editCueUrl,
              })}
              className="px-3 py-2 rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: orgColor }}>
              Save
            </button>
          </div>
        </div>
      ) : (
        // ── Display mode ──────────────────────────────────────────────────────
        <>
          <div className="flex items-center gap-2">
            {/* Drag handle — bumped to 40 px (Apple HIG min touch target) and
                color lifted from #4a2020 to a 50%-white that reads cleanly
                against the new #1f0808 row bg. */}
            <div
              className="flex items-center justify-center w-10 h-10 shrink-0 rounded-lg cursor-grab active:cursor-grabbing touch-none transition-colors hover:bg-[rgba(255,255,255,0.06)]"
              style={{ color: 'rgba(255,255,255,0.5)', fontSize: 20 }}
              onMouseDown={e => { e.preventDefault(); onStartDrag(index) }}
              onTouchStart={e => { e.preventDefault(); onStartDrag(index) }}>
              ⠿
            </div>

            {/* Drill name — UPPERCASE display only (db value preserved as
                typed) + ~95% white. Wider letter-spacing reads as a header
                style. The "Untitled drill" fallback sits inside the same
                span so it inherits uppercase too. */}
            <span
              className="flex-1 text-base font-bold truncate uppercase tracking-wide"
              style={{ color: 'rgba(255,255,255,0.95)', letterSpacing: '0.04em' }}
            >
              {drill.name || <span style={{ color: '#7a4040', fontStyle: 'italic', fontWeight: 400 }}>Untitled drill</span>}
            </span>
            {/* Cue attached indicator — clickable to preview without entering edit mode */}
            {drill.cue_mp3_url && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); playCue(drill.cue_mp3_url) }}
                className="text-xs shrink-0 px-2 py-1 rounded-md transition-colors"
                style={{ color: orgColor, border: `1px solid ${orgColor}77`, backgroundColor: 'transparent' }}
                title="Preview cue"
              >
                🎵
              </button>
            )}
            {/* Duration — bumped from #9a8080 to ~85% white so it reads
                clearly against the new lighter row bg. */}
            <span
              className="text-sm font-mono shrink-0 px-2"
              style={{ color: 'rgba(255,255,255,0.85)' }}
            >
              {drill.duration ? fmt(drill.duration) : '—'}
            </span>

            {/* Edit + Delete — 40 × 40 (Apple HIG min). Edit lifts to ~85%
                white; Delete uses a clearer red so its destructive intent
                reads. Both get a subtle hover bg (and Delete a slightly
                tinted red hover) so the affordance is unambiguous. */}
            <button onClick={() => onEditStart(index)}
              aria-label="Edit drill"
              className="w-10 h-10 flex items-center justify-center rounded-lg text-base shrink-0 transition-colors hover:bg-[rgba(255,255,255,0.08)]"
              style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid #3a1414' }}>
              ✎
            </button>
            <button onClick={() => onDelete(index)}
              aria-label="Delete drill"
              className="w-10 h-10 flex items-center justify-center rounded-lg text-base shrink-0 transition-colors hover:bg-[rgba(220,80,80,0.14)]"
              style={{ color: 'rgba(220,80,80,0.9)', border: '1px solid #3a1414' }}>
              ✕
            </button>
          </div>

          {/* Notes preview — bumped from #9a8080 to ~75% white so notes
              actually look like notes, not page chrome. */}
          {drill.notes && drill.notes.trim() && (
            <p
              className="text-xs leading-snug pl-12 pr-2 whitespace-pre-wrap"
              style={{ color: 'rgba(255,255,255,0.75)' }}
            >
              {drill.notes}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── ScriptEditor ──────────────────────────────────────────────────────────────
function ScriptEditor({ script, orgId, userId, orgColor, isGuest, isActive,
  programName, programNameColor, programLogoUrl,
  onBack, onSetActive, onSwitchTab, onReload }) {
  const [name,   setName]   = useState(script.name  ?? '')
  const [sport,  setSport]  = useState(script.sport ?? 'football')
  const [drills, setDrills] = useState(script.drills ?? [])
  const [editingIndex,  setEditingIndex]  = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState('')  // '' | 'saving' | 'saved' | error string
  const [showPrint, setShowPrint] = useState(false)
  const saveTimer = useRef(null)
  const scriptId  = useRef(script.id)

  // ── Save (debounced) ────────────────────────────────────────────────────────
  const save = useCallback(async (nextName, nextSport, nextDrills) => {
    setSaveMsg('saving')
    setSaving(true)
    const payload = {
      name:   nextName.trim()  || 'Untitled Script',
      sport:  nextSport.toLowerCase(),
      // Each drill carries its own `notes` (string), `show_notes` (boolean —
      // controls whether the practice screen renders the note under the
      // current drill name), and `cue_mp3_url` (optional public URL to a
      // one-shot MP3 that interrupts the main playlist when the drill
      // becomes active). Missing/undefined for any of these is treated as
      // empty/false.
      drills: nextDrills.map(d => ({
        name:        d.name.trim(),
        duration:    Number(d.duration) || 0,
        notes:       typeof d.notes === 'string' ? d.notes.trim() : '',
        show_notes:  !!d.show_notes,
        cue_mp3_url: typeof d.cue_mp3_url === 'string' ? d.cue_mp3_url : '',
      })),
    }

    try {
      if (isGuest) {
        const saved = saveGuestScript({ id: scriptId.current, ...payload })
        if (!scriptId.current) scriptId.current = saved.id
      } else {
        if (scriptId.current) {
          const { error } = await supabase
            .from('scripts').update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', scriptId.current)
          if (error) throw error
        } else {
          const { data, error } = await supabase
            .from('scripts')
            .insert({ org_id: orgId, created_by: userId, ...payload })
            .select().single()
          if (error) throw error
          scriptId.current = data.id
        }
      }
      setSaveMsg('saved')
      onReload()
      setTimeout(() => setSaveMsg(''), 2000)
    } catch (err) {
      console.error('[Scripts] Save error:', err.message)
      setSaveMsg('Error saving — ' + (err.message ?? 'unknown'))
      setTimeout(() => setSaveMsg(''), 4000)
    } finally {
      setSaving(false)
    }
  }, [isGuest, orgId, userId, onReload])

  // Debounce saves by 600ms after any change
  function schedSave(nextName, nextSport, nextDrills) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      save(nextName, nextSport, nextDrills)
    }, 600)
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  function updateName(v)   { setName(v);  schedSave(v,    sport,  drills) }
  function updateSport(v)  { setSport(v); schedSave(name, v,      drills) }
  function updateDrills(d) { setDrills(d); schedSave(name, sport,  d) }

  // ── Drill mutations ─────────────────────────────────────────────────────────
  function addDrill(fields) {
    const next = [
      ...drills,
      {
        name:        fields.name,
        duration:    fields.duration,
        notes:       fields.notes ?? '',
        show_notes:  !!fields.show_notes,
        cue_mp3_url: fields.cue_mp3_url ?? '',
      },
    ]
    setDrills(next)
    schedSave(name, sport, next)
  }

  function saveDrill(index, updates) {
    const next = drills.map((d, i) => i === index ? { ...d, ...updates } : d)
    updateDrills(next)
    setEditingIndex(null)
  }

  function deleteDrill(index) {
    const next = drills.filter((_, i) => i !== index)
    updateDrills(next)
    if (editingIndex === index) setEditingIndex(null)
  }

  // ── Drag reorder ────────────────────────────────────────────────────────────
  const { dragging, over, rowRefs, startDrag } = useDragReorder(drills, d => {
    setEditingIndex(null)
    updateDrills(d)
  })

  // ── Load to Practice ────────────────────────────────────────────────────────
  // Awaits any pending or first-time save so scriptId.current is real before
  // we tell the parent to set this script active. Without the await, onSetActive
  // gets passed { id: null }, which clears the persisted "last loaded" pointer.
  async function loadToPractice() {
    const hasPending = !!saveTimer.current
    const isUnsaved  = !scriptId.current
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    if (hasPending || isUnsaved) {
      await save(name, sport, drills)
    }
    const scriptObj = {
      id:     scriptId.current,
      name,
      sport,
      drills,
    }
    onSetActive(scriptObj)
    if (onSwitchTab) onSwitchTab('practice')
  }

  // ── Save indicator ──────────────────────────────────────────────────────────
  const saveIndicator = saveMsg === 'saving' ? (
    <span className="text-xs" style={{ color: '#9a8080' }}>Saving…</span>
  ) : saveMsg === 'saved' ? (
    <span className="text-xs" style={{ color: '#1db954' }}>✓ Saved</span>
  ) : saveMsg ? (
    <span className="text-xs" style={{ color: '#ff6666' }}>{saveMsg}</span>
  ) : null

  const sec = totalSec(drills)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Editor header ────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 md:px-6 pt-4 pb-3 flex items-center gap-3"
        style={{ borderBottom: '1px solid #1a0000' }}>
        {/* Back */}
        <button onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-xl shrink-0"
          style={{ color: '#9a8080', backgroundColor: '#1a0000', border: '1px solid #2a0000' }}>
          ←
        </button>

        {/* Editable script name */}
        <input
          value={name} onChange={e => updateName(e.target.value)}
          placeholder="Script name"
          className="flex-1 text-lg font-black text-white outline-none bg-transparent
            border-b-2 px-1 py-1"
          style={{ borderBottomColor: '#2a0000' }}
        />

        {/* Save indicator */}
        <div className="shrink-0">{saveIndicator}</div>

        {/* Load to Practice */}
        <button onClick={loadToPractice}
          className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: orgColor }}>
          Load to Practice
        </button>
      </div>

      {/* ── Sport + stats bar ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 md:px-6 py-2.5 flex items-center gap-4"
        style={{ borderBottom: '1px solid #1a0000' }}>
        <select value={sport} onChange={e => updateSport(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm outline-none"
          style={INPUT_STYLE}>
          {SPORTS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: '#9a8080' }}>
          {drills.length} segment{drills.length !== 1 ? 's' : ''}
        </span>
        <span className="text-xs font-mono" style={{ color: '#9a8080' }}>
          {fmt(sec)} total
        </span>

        {/* Print script — opens a dialog asking for the practice start time. */}
        <button onClick={() => setShowPrint(true)}
          className="ml-auto text-xs font-bold px-3 py-1.5 rounded-lg"
          style={{ border: `1px solid ${orgColor}66`, color: orgColor, backgroundColor: 'transparent' }}>
          🖨 Print Script
        </button>

        {isActive && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: orgColor + '22', color: orgColor,
              border: `1px solid ${orgColor}66` }}>
            Active
          </span>
        )}
      </div>

      {/* Print Script dialog — declared at the editor level so the modal can
          reach the script's name, drills, sport, and notes. */}
      {showPrint && (
        <PrintScriptDialog
          scriptName={name}
          drills={drills}
          orgColor={orgColor}
          programName={programName}
          programNameColor={programNameColor}
          programLogoUrl={programLogoUrl}
          onClose={() => setShowPrint(false)}
        />
      )}

      {/* ── Drill list ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {drills.length === 0 && (
            <div className="text-center py-10" style={{ color: '#4a2020' }}>
              <p className="text-sm">No drills yet — add one below.</p>
            </div>
          )}

          {drills.map((drill, i) => (
            <DrillRow
              key={i}
              drill={drill}
              index={i}
              isEditing={editingIndex === i}
              isDragging={dragging === i}
              isOver={over === i && dragging !== null && dragging !== i}
              orgColor={orgColor}
              orgId={orgId}
              isGuest={isGuest}
              rowRef={el => { rowRefs.current[i] = el }}
              onStartDrag={startDrag}
              onEditStart={idx => setEditingIndex(idx === editingIndex ? null : idx)}
              onEditSave={saveDrill}
              onEditCancel={() => setEditingIndex(null)}
              onDelete={deleteDrill}
            />
          ))}

          {/* ── Add drill form ──────────────────────────────────────────── */}
          <AddDrillForm orgColor={orgColor} orgId={orgId} isGuest={isGuest} onAdd={addDrill} />
        </div>
      </div>
    </div>
  )
}

// ── ScriptsSection (main export) ─────────────────────────────────────────────
export default function ScriptsSection({
  scripts, activeScript, onSetActive,
  orgId, userId, orgColor, isGuest, orgSport,
  programName, programNameColor, programLogoUrl,
  onReload, onSwitchTab,
}) {
  const [view,           setView]          = useState('list')   // 'list' | 'editor'
  const [editingScript,  setEditingScript] = useState(null)
  const [showNew,        setShowNew]       = useState(false)
  const [deleteId,       setDeleteId]      = useState(null)
  const [deleting,       setDeleting]      = useState(false)

  function openEditor(script) {
    setEditingScript(script)
    setView('editor')
  }

  function handleNew(fields) {
    setShowNew(false)
    // Create a temporary script object with no id — editor will persist it on first save
    openEditor({ id: null, ...fields })
  }

  async function confirmDelete() {
    setDeleting(true)
    if (isGuest) {
      deleteGuestScript(deleteId)
    } else {
      await supabase.from('scripts').delete().eq('id', deleteId)
    }
    if (activeScript?.id === deleteId) onSetActive(null)
    setDeleteId(null); setDeleting(false)
    onReload()
  }

  // ── Editor view ─────────────────────────────────────────────────────────────
  if (view === 'editor' && editingScript) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ScriptEditor
          script={editingScript}
          orgId={orgId}
          userId={userId}
          orgColor={orgColor}
          isGuest={isGuest}
          isActive={activeScript?.id === editingScript.id}
          programName={programName}
          programNameColor={programNameColor}
          programLogoUrl={programLogoUrl}
          onBack={() => { setView('list'); setEditingScript(null); onReload() }}
          onSetActive={onSetActive}
          onSwitchTab={onSwitchTab}
          onReload={onReload}
        />
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 max-w-5xl mx-auto">
        <h2 className="font-bold text-white text-lg">Practice Scripts</h2>
        <button onClick={() => setShowNew(true)}
          className="px-5 py-3 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: orgColor }}>
          + New Script
        </button>
      </div>

      {scripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-center max-w-5xl mx-auto">
          <div style={{ fontSize: 64, opacity: 0.1 }}>📋</div>
          <p className="font-bold text-white text-lg">No scripts yet</p>
          <p className="text-sm" style={{ color: '#9a8080' }}>
            Create your first practice script to get started.
          </p>
          <button onClick={() => setShowNew(true)}
            className="mt-2 px-6 py-3 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: orgColor }}>
            Create Script
          </button>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
          {scripts.map(script => {
            const isActive   = activeScript?.id === script.id
            const drillCount = script.drills?.length ?? 0
            const sec        = totalSec(script.drills)
            const updated    = new Date(script.updated_at ?? script.created_at).toLocaleDateString()

            return (
              <div
                key={script.id}
                className="rounded-2xl p-5 flex flex-col gap-3 transition-all cursor-pointer"
                style={{
                  backgroundColor: '#1a0000',
                  border: `2px solid ${isActive ? orgColor : '#2a0000'}`,
                  boxShadow: isActive ? `0 0 24px ${orgColor}44` : 'none',
                }}
                onClick={() => openEditor(script)}
              >
                {/* Top row: name + active badge + buttons */}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-white truncate text-base">{script.name}</p>
                      {isActive && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                          style={{ backgroundColor: orgColor + '22', color: orgColor,
                            border: `1px solid ${orgColor}66` }}>
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: '#9a8080' }}>
                      {script.sport} · {drillCount} segment{drillCount !== 1 ? 's' : ''} · {fmt(sec)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#4a2020' }}>Updated {updated}</p>
                  </div>

                  {/* Action buttons — stop click propagation so they don't open editor */}
                  <div className="flex flex-col gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {/* Load to Practice */}
                    <button
                      onClick={() => {
                        onSetActive(script)
                        if (onSwitchTab) onSwitchTab('practice')
                      }}
                      className="px-4 py-2 rounded-lg text-xs font-bold transition-all"
                      style={{
                        backgroundColor: isActive ? orgColor : 'transparent',
                        border: `1px solid ${isActive ? orgColor : '#3a1010'}`,
                        color: isActive ? '#fff' : '#cc8888',
                      }}>
                      {isActive ? '✓ Active' : 'Load'}
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => openEditor(script)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold"
                      style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
                      Edit
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => setDeleteId(script.id)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold"
                      style={{ border: '1px solid #2a0000', color: '#6a3030' }}>
                      Delete
                    </button>
                  </div>
                </div>

                {/* Drill chips preview */}
                {drillCount > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(script.drills ?? []).slice(0, 5).map((d, i) => (
                      <span key={i} className="text-xs px-2.5 py-1 rounded-full"
                        style={{ backgroundColor: '#2a0000', color: isActive ? '#cc8888' : '#7a5050' }}>
                        {d.name}
                        <span className="ml-1 opacity-60">{fmt(d.duration ?? 0)}</span>
                      </span>
                    ))}
                    {drillCount > 5 && (
                      <span className="text-xs px-2.5 py-1 rounded-full"
                        style={{ backgroundColor: '#2a0000', color: '#7a5050' }}>
                        +{drillCount - 5} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* New Script dialog */}
      {showNew && (
        <NewScriptDialog
          orgColor={orgColor}
          defaultSport={orgSport?.toLowerCase() ?? 'football'}
          onCancel={() => setShowNew(false)}
          onCreate={handleNew}
        />
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
            style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>
            <h3 className="font-bold text-white text-lg">Delete script?</h3>
            <p className="text-sm" style={{ color: '#9a8080' }}>This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)}
                className="flex-1 py-3 rounded-lg text-sm font-semibold"
                style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: '#cc1111' }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
