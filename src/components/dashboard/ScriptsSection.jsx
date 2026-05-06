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

// ── AddDrillForm ──────────────────────────────────────────────────────────────
// Persistent form at the bottom of the drill list. Owns its own state,
// reads values on Add click, calls onAdd(fields), then clears itself.
const DURATION_PRESETS = [5, 10, 15, 20]

function AddDrillForm({ orgColor, onAdd }) {
  const [name, setName] = useState('')
  const [mins, setMins] = useState('')
  const [secs, setSecs] = useState('')

  const activePreset = (m) =>
    Number(mins) === m && (secs === '' || secs === '0' || Number(secs) === 0)

  function handleAdd() {
    const drillName = name.trim()
    const duration  = Number(mins || 0) * 60 + Number(secs || 0)
    console.log('[AddDrill] name:', JSON.stringify(drillName), 'mins:', mins, 'secs:', secs, '→ duration (s):', duration)
    onAdd({ name: drillName, duration })
    setName('')
    setMins('')
    setSecs('')
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
  const [editName, setEditName] = useState(drill.name ?? '')
  const [editMins, setEditMins] = useState(drill.duration ? String(Math.floor(drill.duration / 60)) : '')
  const [editSecs, setEditSecs] = useState(drill.duration ? String(drill.duration % 60) : '')

  // Sync edit fields when editing starts
  useEffect(() => {
    if (isEditing) {
      setEditName(drill.name ?? '')
      setEditMins(drill.duration ? String(Math.floor(drill.duration / 60)) : '')
      setEditSecs(drill.duration ? String(drill.duration % 60) : '')
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
          <div className="flex gap-2 justify-end">
            <button onClick={onEditCancel}
              className="px-3 py-2 rounded-lg text-xs font-semibold"
              style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
              Cancel
            </button>
            <button
              onClick={() => onEditSave(index, {
                name: editName.trim(),
                duration: Number(editMins || 0) * 60 + Number(editSecs || 0),
              })}
              className="px-3 py-2 rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: orgColor }}>
              Save
            </button>
          </div>
        </div>
      ) : (
        // ── Display mode ──────────────────────────────────────────────────────
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
      )}
    </div>
  )
}

// ── ScriptEditor ──────────────────────────────────────────────────────────────
function ScriptEditor({ script, orgId, userId, orgColor, isGuest, isActive,
  onBack, onSetActive, onSwitchTab, onReload }) {
  const [name,   setName]   = useState(script.name  ?? '')
  const [sport,  setSport]  = useState(script.sport ?? 'football')
  const [drills, setDrills] = useState(script.drills ?? [])
  const [editingIndex,  setEditingIndex]  = useState(null)
  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState('')  // '' | 'saving' | 'saved' | error string
  const saveTimer = useRef(null)
  const scriptId  = useRef(script.id)

  // ── Save (debounced) ────────────────────────────────────────────────────────
  const save = useCallback(async (nextName, nextSport, nextDrills) => {
    setSaveMsg('saving')
    setSaving(true)
    const payload = {
      name:   nextName.trim()  || 'Untitled Script',
      sport:  nextSport.toLowerCase(),
      drills: nextDrills.map(d => ({ name: d.name.trim(), duration: Number(d.duration) || 0 })),
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
    const next = [...drills, { name: fields.name, duration: fields.duration }]
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
  function loadToPractice() {
    // Flush any pending save first
    if (saveTimer.current) { clearTimeout(saveTimer.current); save(name, sport, drills) }
    const scriptObj = { id: scriptId.current, name, sport, drills }
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

        {isActive && (
          <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: orgColor + '22', color: orgColor,
              border: `1px solid ${orgColor}66` }}>
            Active
          </span>
        )}
      </div>

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
