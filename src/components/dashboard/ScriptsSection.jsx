import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { saveGuestScript, deleteGuestScript } from '../../lib/guestStorage'

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
  table { width: 100%; border-collapse: collapse; font-size: 12pt; }
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
  }
  tbody tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f6f6f6; }
  .num   { width: 56px; text-align: center; font-weight: 700; }
  .time  { width: 96px; white-space: nowrap; font-weight: 700; }
  .dur   { width: 80px; white-space: nowrap; }
  .drill { font-weight: 700; }
  .notes { color: #444; font-size: 11pt; }
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
          <th>Drill</th>
          <th>Notes</th>
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

// ── AddDrillForm ──────────────────────────────────────────────────────────────
// Persistent form at the bottom of the drill list. Owns its own state,
// reads values on Add click, calls onAdd(fields), then clears itself.
const DURATION_PRESETS = [5, 10, 15, 20]

function AddDrillForm({ orgColor, onAdd }) {
  const [name,  setName]  = useState('')
  const [mins,  setMins]  = useState('')
  const [secs,  setSecs]  = useState('')
  const [notes, setNotes] = useState('')

  const activePreset = (m) =>
    Number(mins) === m && (secs === '' || secs === '0' || Number(secs) === 0)

  function handleAdd() {
    const drillName = name.trim()
    const duration  = Number(mins || 0) * 60 + Number(secs || 0)
    console.log('[AddDrill] name:', JSON.stringify(drillName), 'mins:', mins, 'secs:', secs, '→ duration (s):', duration)
    onAdd({ name: drillName, duration, notes: notes.trim() })
    setName('')
    setMins('')
    setSecs('')
    setNotes('')
  }

  return (
    <div className="rounded-xl p-3 flex flex-col gap-3 mt-1"
      style={{ border: `2px dashed ${orgColor}44`, backgroundColor: '#0d0000' }}>

      <input
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

      <button onClick={handleAdd} disabled={!name.trim()}
        className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
        style={{ backgroundColor: orgColor }}>
        + Add Drill
      </button>
    </div>
  )
}

// ── DrillRow ──────────────────────────────────────────────────────────────────

function DrillRow({ drill, index, isEditing, isDragging, isOver, orgColor,
  rowRef, onStartDrag, onEditStart, onEditSave, onEditCancel, onDelete }) {
  const [editName,  setEditName]  = useState(drill.name ?? '')
  const [editMins,  setEditMins]  = useState(drill.duration ? String(Math.floor(drill.duration / 60)) : '')
  const [editSecs,  setEditSecs]  = useState(drill.duration ? String(drill.duration % 60) : '')
  const [editNotes, setEditNotes] = useState(drill.notes ?? '')

  // Sync edit fields when editing starts
  useEffect(() => {
    if (isEditing) {
      setEditName(drill.name ?? '')
      setEditMins(drill.duration ? String(Math.floor(drill.duration / 60)) : '')
      setEditSecs(drill.duration ? String(drill.duration % 60) : '')
      setEditNotes(drill.notes ?? '')
    }
  }, [isEditing, drill])

  const rowStyle = {
    backgroundColor: isDragging ? '#2a0808' : '#1a0000',
    border: `1px solid ${isOver && !isDragging ? orgColor + '88' : '#2a0000'}`,
    opacity: isDragging ? 0.5 : 1,
    transition: 'background-color 0.1s, border-color 0.1s',
    userSelect: 'none',
  }

  return (
    <div ref={rowRef} className="rounded-xl p-3 flex flex-col gap-2" style={rowStyle}>
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
          <div className="flex gap-2 justify-end">
            <button onClick={onEditCancel}
              className="px-3 py-2 rounded-lg text-xs font-semibold"
              style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
              Cancel
            </button>
            <button
              onClick={() => onEditSave(index, {
                name:     editName.trim(),
                duration: Number(editMins || 0) * 60 + Number(editSecs || 0),
                notes:    editNotes.trim(),
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
            {/* Drag handle */}
            <div
              className="flex items-center justify-center w-8 h-8 shrink-0 rounded-lg cursor-grab active:cursor-grabbing touch-none"
              style={{ color: '#4a2020', fontSize: 18 }}
              onMouseDown={e => { e.preventDefault(); onStartDrag(index) }}
              onTouchStart={e => { e.preventDefault(); onStartDrag(index) }}>
              ⠿
            </div>

            {/* Name + duration */}
            <span className="flex-1 text-base font-bold text-white truncate">
              {drill.name || <span style={{ color: '#4a2020', fontStyle: 'italic', fontWeight: 400 }}>Untitled drill</span>}
            </span>
            <span className="text-sm font-mono shrink-0 px-2" style={{ color: '#9a8080' }}>
              {drill.duration ? fmt(drill.duration) : '—'}
            </span>

            {/* Edit + Delete */}
            <button onClick={() => onEditStart(index)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-xs shrink-0"
              style={{ color: '#9a8080', border: '1px solid #2a0000' }}>
              ✎
            </button>
            <button onClick={() => onDelete(index)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-xs shrink-0"
              style={{ color: '#6a3030', border: '1px solid #2a0000' }}>
              ✕
            </button>
          </div>

          {/* Notes preview — shown only when present */}
          {drill.notes && drill.notes.trim() && (
            <p className="text-xs leading-snug pl-10 pr-2 whitespace-pre-wrap" style={{ color: '#9a8080' }}>
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
  const [showNotesOnPractice, setShowNotesOnPractice] = useState(!!script.show_notes_on_practice)
  const [editingIndex,  setEditingIndex]  = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState('')  // '' | 'saving' | 'saved' | error string
  const [showPrint, setShowPrint] = useState(false)
  const saveTimer = useRef(null)
  const scriptId  = useRef(script.id)

  // ── Save (debounced) ────────────────────────────────────────────────────────
  const save = useCallback(async (nextName, nextSport, nextDrills, nextShowNotes) => {
    setSaveMsg('saving')
    setSaving(true)
    const payload = {
      name:   nextName.trim()  || 'Untitled Script',
      sport:  nextSport.toLowerCase(),
      // Each drill gets `notes` (string) preserved alongside name + duration.
      drills: nextDrills.map(d => ({
        name:     d.name.trim(),
        duration: Number(d.duration) || 0,
        notes:    typeof d.notes === 'string' ? d.notes.trim() : '',
      })),
      show_notes_on_practice: !!nextShowNotes,
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
  function schedSave(nextName, nextSport, nextDrills, nextShowNotes) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      save(nextName, nextSport, nextDrills, nextShowNotes)
    }, 600)
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  function updateName(v)   { setName(v);  schedSave(v,    sport,  drills, showNotesOnPractice) }
  function updateSport(v)  { setSport(v); schedSave(name, v,      drills, showNotesOnPractice) }
  function updateDrills(d) { setDrills(d); schedSave(name, sport,  d,      showNotesOnPractice) }
  function updateShowNotes(v) { setShowNotesOnPractice(v); schedSave(name, sport, drills, v) }

  // ── Drill mutations ─────────────────────────────────────────────────────────
  function addDrill(fields) {
    const next = [...drills, { name: fields.name, duration: fields.duration, notes: fields.notes ?? '' }]
    setDrills(next)
    schedSave(name, sport, next, showNotesOnPractice)
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
      await save(name, sport, drills, showNotesOnPractice)
    }
    const scriptObj = {
      id:     scriptId.current,
      name,
      sport,
      drills,
      show_notes_on_practice: showNotesOnPractice,
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

        {/* Show-notes-on-practice toggle (per script). */}
        <label className="ml-auto flex items-center gap-2 cursor-pointer select-none text-xs"
          style={{ color: '#9a8080' }}>
          <input
            type="checkbox"
            checked={showNotesOnPractice}
            onChange={e => updateShowNotes(e.target.checked)}
            className="w-3.5 h-3.5 cursor-pointer"
            style={{ accentColor: orgColor }}
          />
          Show notes on practice screen
        </label>

        {/* Print script — opens a dialog asking for the practice start time. */}
        <button onClick={() => setShowPrint(true)}
          className="text-xs font-bold px-3 py-1.5 rounded-lg"
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
              rowRef={el => { rowRefs.current[i] = el }}
              onStartDrag={startDrag}
              onEditStart={idx => setEditingIndex(idx === editingIndex ? null : idx)}
              onEditSave={saveDrill}
              onEditCancel={() => setEditingIndex(null)}
              onDelete={deleteDrill}
            />
          ))}

          {/* ── Add drill form ──────────────────────────────────────────── */}
          <AddDrillForm orgColor={orgColor} onAdd={addDrill} />
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
