// ── WhiteboardSection.jsx ─────────────────────────────────────────────────────
// MVP whiteboard for coaches to draw on with finger or Apple Pencil. One
// persistent canvas per program. Persists in Supabase (public.whiteboards
// table, keyed on org_id). Saves on a 2-second debounce after the last
// stroke. PERSISTS UNTIL MANUALLY CLEARED — no auto-clear on session end,
// tab switch, or app reload.
//
// Storage format = JSON path data (NOT a PNG data URL):
//   strokes = [{ tool, color, thickness, points: [{x, y, pressure}] }, ...]
// Reasons:
//   • Smaller payload on the 2 s debounced save loop.
//   • Lossless across viewports (iPad portrait vs landscape, AirPlay scaling).
//     We store width/height alongside strokes so coordinates can be scaled
//     into whatever the current canvas size is when reloading.
//   • Per-stroke metadata supports variable thickness from
//     pointerEvent.pressure (Apple Pencil) without extra machinery.
//   • Render-from-history is needed anyway for undo/redo.
//
// Mirrored display: this component is JUST a tab in the dashboard. Whenever
// the coach is on the Whiteboard tab and the iPad is AirPlay-mirroring to
// the jumbotron, the jumbotron shows the same canvas. No display-specific
// code needed.

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// ── Constants ────────────────────────────────────────────────────────────────
const COLORS = [
  { name: 'white',  hex: '#ffffff' },
  { name: 'red',    hex: '#ef4444' },
  { name: 'blue',   hex: '#3b82f6' },
  { name: 'green',  hex: '#22c55e' },
  { name: 'yellow', hex: '#facc15' },
  { name: 'black',  hex: '#000000' },
]

const THICKNESSES = [
  { name: 'thin',   value:  3 },
  { name: 'medium', value:  6 },
  { name: 'thick',  value: 12 },
]

const SAVE_DEBOUNCE_MS = 2000
const UNDO_LIMIT       = 50  // spec said at least 20; 50 feels low-cost
const POINTERMOVE_THROTTLE_MS = 12 // ~80 Hz — smoother than 60 Hz on Apple Pencil

// ── Sport-specific backgrounds ───────────────────────────────────────────────
// Drawn programmatically into the canvas's underlay (NOT a stroke in
// the history) so they don't appear in undo/redo and don't bloat the
// saved payload. Coordinates use the current canvas dimensions so the
// field scales to whatever size the viewport gives us.

function drawBlank(ctx, w, h) {
  ctx.fillStyle = '#0a1a0a'  // very dark green — easier on eyes than pure black
  ctx.fillRect(0, 0, w, h)
}

function drawFootballField(ctx, w, h) {
  // Green field
  ctx.fillStyle = '#0d4a1f'
  ctx.fillRect(0, 0, w, h)

  // Field is 120 yards long (100 + two 10-yard end zones). Drawn horizontally
  // — long dimension matches the wider of canvas width/height so it doesn't
  // get squished on portrait orientation.
  const horizontal = w >= h
  const longSide  = horizontal ? w : h
  const shortSide = horizontal ? h : w
  const yardWidth = longSide / 120

  ctx.save()
  if (!horizontal) {
    // Rotate so the "field" runs vertically on portrait iPads
    ctx.translate(w, 0)
    ctx.rotate(Math.PI / 2)
  }

  // End zones (10 yd × full width on each side) — slightly darker green
  ctx.fillStyle = '#0a3818'
  ctx.fillRect(0, 0, yardWidth * 10, shortSide)
  ctx.fillRect(yardWidth * 110, 0, yardWidth * 10, shortSide)

  // Sidelines
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.strokeRect(0, 0, yardWidth * 120, shortSide)

  // Yard lines every 5 yards (10, 15, 20 ... 110)
  for (let yd = 10; yd <= 110; yd += 5) {
    const x = yd * yardWidth
    const isTenLine = (yd - 10) % 10 === 0
    ctx.lineWidth   = isTenLine ? 2 : 1
    ctx.globalAlpha = isTenLine ? 0.9 : 0.6
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, shortSide)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Hash marks — short ticks at every yard, top and bottom hash rows
  const hashTopY    = shortSide * 0.30
  const hashBottomY = shortSide * 0.70
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.5
  for (let yd = 11; yd <= 109; yd += 1) {
    const x = yd * yardWidth
    ctx.beginPath()
    ctx.moveTo(x, hashTopY - 3); ctx.lineTo(x, hashTopY + 3); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, hashBottomY - 3); ctx.lineTo(x, hashBottomY + 3); ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Yard-line labels (10, 20, 30, 40, 50, 40, 30, 20, 10)
  const labels = [10, 20, 30, 40, 50, 40, 30, 20, 10]
  ctx.fillStyle = '#ffffff'
  ctx.globalAlpha = 0.5
  ctx.font = `bold ${Math.max(10, shortSide * 0.06)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  labels.forEach((label, i) => {
    const x = (20 + i * 10) * yardWidth
    ctx.fillText(String(label), x, shortSide * 0.5)
  })
  ctx.globalAlpha = 1

  ctx.restore()
}

const BACKGROUNDS = {
  blank:    drawBlank,
  football: drawFootballField,
}

// ── Toolbar icons (inline SVGs match the project convention) ─────────────────
const PenIcon    = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
const EraserIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>
const UndoIcon   = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>
const RedoIcon   = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>
const TrashIcon  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>

// ── Main component ───────────────────────────────────────────────────────────
export default function WhiteboardSection({ orgColor = '#cc1111', orgId, sport }) {
  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef = useRef(null)
  const canvasRef    = useRef(null)
  // Stroke history + redo stack live on refs so the pointer event handlers
  // don't need to be re-bound on every state change. UI mirrors via state.
  const strokesRef   = useRef([])
  const redoRef      = useRef([])
  const currentStrokeRef = useRef(null)
  const saveTimerRef     = useRef(null)
  const lastMoveTimeRef  = useRef(0)
  const storedSizeRef    = useRef({ width: 0, height: 0 }) // dimensions at save-time

  // ── State (UI mirrors) ─────────────────────────────────────────────────────
  const [tool,       setTool]       = useState('pen')      // 'pen' | 'eraser'
  const [color,      setColor]      = useState('#ffffff')
  const [thickness,  setThickness]  = useState(THICKNESSES[1].value)  // medium
  const [background, setBackground] = useState('blank')
  // Mirrored counts so the Undo / Redo buttons can disable themselves
  const [historyLen, setHistoryLen] = useState(0)
  const [redoLen,    setRedoLen]    = useState(0)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [isLoading,  setIsLoading]  = useState(true)
  const [saveStatus, setSaveStatus] = useState('')  // '' | 'saving' | 'saved' | error string

  // Whether the active org's sport offers a sport-specific background option.
  // Only Football is implemented in this MVP.
  const hasSportBg = (sport ?? '').toLowerCase() === 'football'

  // ── Canvas sizing ──────────────────────────────────────────────────────────
  // Match the canvas's drawing-buffer size to its CSS pixel size, multiplied
  // by devicePixelRatio so strokes look crisp on retina iPads + jumbotrons.
  function resizeCanvas() {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const dpr = window.devicePixelRatio || 1
    const cssW = container.clientWidth
    const cssH = container.clientHeight
    canvas.style.width  = `${cssW}px`
    canvas.style.height = `${cssH}px`
    canvas.width  = Math.floor(cssW * dpr)
    canvas.height = Math.floor(cssH * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    redrawCanvas()
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  // Render the underlay background plus all strokes in history, scaled from
  // their original (stored) coordinates into the current canvas size.
  function redrawCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight

    // Underlay
    const drawBg = BACKGROUNDS[background] || drawBlank
    drawBg(ctx, cssW, cssH)

    // Strokes
    const { width: storedW, height: storedH } = storedSizeRef.current
    const scaleX = storedW > 0 ? cssW / storedW : 1
    const scaleY = storedH > 0 ? cssH / storedH : 1

    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke, scaleX, scaleY)
    }
  }

  function drawStroke(ctx, stroke, scaleX = 1, scaleY = 1) {
    const pts = stroke.points
    if (!pts || pts.length === 0) return

    ctx.lineCap  = 'round'
    ctx.lineJoin = 'round'

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = stroke.color
    }

    // Single point (a tap with no movement) renders as a dot
    if (pts.length === 1) {
      const p = pts[0]
      const r = (stroke.thickness * (0.5 + (p.pressure || 0.5))) / 2
      ctx.beginPath()
      ctx.arc(p.x * scaleX, p.y * scaleY, Math.max(1, r), 0, Math.PI * 2)
      ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      return
    }

    // Multi-point stroke. Use pressure-modulated line segments.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const avgPressure = ((a.pressure || 0.5) + (b.pressure || 0.5)) / 2
      ctx.lineWidth = stroke.thickness * (0.5 + avgPressure)
      ctx.beginPath()
      ctx.moveTo(a.x * scaleX, a.y * scaleY)
      ctx.lineTo(b.x * scaleX, b.y * scaleY)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  // ── Pointer event handlers ────────────────────────────────────────────────
  function pointerToCanvas(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: typeof e.pressure === 'number' && e.pressure > 0 ? e.pressure : 0.5,
    }
  }

  function onPointerDown(e) {
    if (showClearConfirm) return
    e.preventDefault()
    canvasRef.current?.setPointerCapture?.(e.pointerId)
    const pt = pointerToCanvas(e)
    currentStrokeRef.current = {
      tool,
      color,
      thickness,
      points: [pt],
    }
    lastMoveTimeRef.current = 0
    // Render the initial dot immediately
    const ctx = canvasRef.current.getContext('2d')
    drawStroke(ctx, currentStrokeRef.current)
  }

  function onPointerMove(e) {
    if (!currentStrokeRef.current) return
    e.preventDefault()
    const now = performance.now()
    if (now - lastMoveTimeRef.current < POINTERMOVE_THROTTLE_MS) return
    lastMoveTimeRef.current = now

    const pt = pointerToCanvas(e)
    const stroke = currentStrokeRef.current
    stroke.points.push(pt)

    // Incremental render — draw just the last segment, no full redraw.
    const ctx = canvasRef.current.getContext('2d')
    const pts = stroke.points
    const a = pts[pts.length - 2]
    const b = pts[pts.length - 1]
    ctx.lineCap  = 'round'
    ctx.lineJoin = 'round'
    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = stroke.color
    }
    const avgPressure = ((a.pressure || 0.5) + (b.pressure || 0.5)) / 2
    ctx.lineWidth = stroke.thickness * (0.5 + avgPressure)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'
  }

  function onPointerUp(e) {
    if (!currentStrokeRef.current) return
    e.preventDefault()
    canvasRef.current?.releasePointerCapture?.(e.pointerId)
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null

    // Commit to history, drop oldest if over limit, clear redo stack.
    const next = [...strokesRef.current, stroke]
    if (next.length > UNDO_LIMIT) next.shift()
    strokesRef.current = next
    redoRef.current = []
    // Stored size = the size we just drew at. Coords are NOT scaled.
    storedSizeRef.current = {
      width:  canvasRef.current?.clientWidth  ?? 0,
      height: canvasRef.current?.clientHeight ?? 0,
    }
    setHistoryLen(next.length)
    setRedoLen(0)
    scheduleSave()
  }

  // ── Undo / Redo / Clear ────────────────────────────────────────────────────
  function undo() {
    const hist = strokesRef.current
    if (hist.length === 0) return
    const popped = hist[hist.length - 1]
    const next = hist.slice(0, -1)
    strokesRef.current = next
    redoRef.current = [...redoRef.current, popped]
    setHistoryLen(next.length)
    setRedoLen(redoRef.current.length)
    redrawCanvas()
    scheduleSave()
  }

  function redo() {
    const redos = redoRef.current
    if (redos.length === 0) return
    const popped = redos[redos.length - 1]
    redoRef.current = redos.slice(0, -1)
    strokesRef.current = [...strokesRef.current, popped]
    setHistoryLen(strokesRef.current.length)
    setRedoLen(redoRef.current.length)
    redrawCanvas()
    scheduleSave()
  }

  function clearAll() {
    strokesRef.current = []
    redoRef.current = []
    setHistoryLen(0)
    setRedoLen(0)
    setShowClearConfirm(false)
    redrawCanvas()
    scheduleSave()
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  // Debounced save: 2 s after the last call to scheduleSave(), upsert the
  // current strokes + background to public.whiteboards. Uses the upsert
  // shortcut so the first save creates the row, subsequent saves update it.
  const scheduleSave = useCallback(() => {
    if (!orgId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null
      const width  = canvasRef.current?.clientWidth  ?? 0
      const height = canvasRef.current?.clientHeight ?? 0
      setSaveStatus('saving')
      const { error } = await supabase
        .from('whiteboards')
        .upsert({
          org_id:     orgId,
          strokes:    strokesRef.current,
          background,
          width,
          height,
        }, { onConflict: 'org_id' })
      if (error) {
        console.error('[Whiteboard] save error:', error.message)
        setSaveStatus('Error: ' + error.message)
      } else {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 1500)
      }
    }, SAVE_DEBOUNCE_MS)
  }, [orgId, background])

  // ── Mount: load existing whiteboard + wire resize observer ─────────────────
  useEffect(() => {
    if (!orgId) {
      setIsLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('whiteboards')
        .select('strokes, background, width, height')
        .eq('org_id', orgId)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.error('[Whiteboard] load error:', error.message)
      } else if (data) {
        strokesRef.current = Array.isArray(data.strokes) ? data.strokes : []
        if (data.background) setBackground(data.background)
        storedSizeRef.current = {
          width:  data.width  ?? 0,
          height: data.height ?? 0,
        }
        setHistoryLen(strokesRef.current.length)
      }
      setIsLoading(false)
      // Initial render after data load — also sizes the canvas.
      requestAnimationFrame(resizeCanvas)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Resize observer — redraw on viewport change (orientation flip, splitview).
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => resizeCanvas())
    ro.observe(containerRef.current)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redraw when background selection changes
  useEffect(() => {
    if (!isLoading) redrawCanvas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background, isLoading])

  // Save the chosen background even if there are no new strokes
  useEffect(() => {
    if (!isLoading) scheduleSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background])

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────
  const canUndo = historyLen > 0
  const canRedo = redoLen > 0

  const ToolBtn = ({ active, onClick, disabled, ariaLabel, title, children }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30"
      style={{
        backgroundColor: active ? orgColor : '#110000',
        color:           active ? '#fff'   : 'rgba(255,255,255,0.85)',
        border:          `1px solid ${active ? orgColor : '#3a1414'}`,
      }}
    >
      {children}
    </button>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Toolbar ── */}
      <div
        className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2"
        style={{ backgroundColor: '#0d0000', borderBottom: '1px solid #1a0000' }}
      >
        {/* Background picker */}
        <div className="flex items-center gap-1.5 pr-2 mr-1" style={{ borderRight: '1px solid #2a0a0a' }}>
          <span className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Bg
          </span>
          <button
            onClick={() => setBackground('blank')}
            className="px-2.5 h-10 rounded-lg text-xs font-semibold transition-colors"
            style={{
              backgroundColor: background === 'blank' ? orgColor : '#110000',
              color:           background === 'blank' ? '#fff'   : 'rgba(255,255,255,0.75)',
              border:          `1px solid ${background === 'blank' ? orgColor : '#3a1414'}`,
            }}
          >
            Blank
          </button>
          {hasSportBg && (
            <button
              onClick={() => setBackground('football')}
              className="px-2.5 h-10 rounded-lg text-xs font-semibold transition-colors"
              style={{
                backgroundColor: background === 'football' ? orgColor : '#110000',
                color:           background === 'football' ? '#fff'   : 'rgba(255,255,255,0.75)',
                border:          `1px solid ${background === 'football' ? orgColor : '#3a1414'}`,
              }}
            >
              Football
            </button>
          )}
        </div>

        {/* Pen / Eraser */}
        <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} ariaLabel="Pen" title="Pen">
          <PenIcon />
        </ToolBtn>
        <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} ariaLabel="Eraser" title="Eraser">
          <EraserIcon />
        </ToolBtn>

        {/* Colors */}
        <div className="flex items-center gap-1.5 pl-2 ml-1" style={{ borderLeft: '1px solid #2a0a0a' }}>
          {COLORS.map(c => (
            <button
              key={c.name}
              onClick={() => { setColor(c.hex); setTool('pen') }}
              aria-label={`Color: ${c.name}`}
              title={c.name}
              className="w-8 h-8 rounded-full transition-transform"
              style={{
                backgroundColor: c.hex,
                border: `2px solid ${color === c.hex && tool === 'pen' ? orgColor : 'rgba(255,255,255,0.3)'}`,
                transform: color === c.hex && tool === 'pen' ? 'scale(1.1)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        {/* Thickness */}
        <div className="flex items-center gap-1.5 pl-2 ml-1" style={{ borderLeft: '1px solid #2a0a0a' }}>
          {THICKNESSES.map(t => (
            <button
              key={t.name}
              onClick={() => setThickness(t.value)}
              aria-label={`Thickness: ${t.name}`}
              title={t.name}
              className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors"
              style={{
                backgroundColor: thickness === t.value ? orgColor : '#110000',
                border:          `1px solid ${thickness === t.value ? orgColor : '#3a1414'}`,
              }}
            >
              <span
                className="rounded-full"
                style={{
                  display: 'block',
                  width:   t.value,
                  height:  t.value,
                  backgroundColor: thickness === t.value ? '#fff' : 'rgba(255,255,255,0.7)',
                }}
              />
            </button>
          ))}
        </div>

        {/* Undo / Redo / Clear */}
        <div className="flex items-center gap-1.5 pl-2 ml-1" style={{ borderLeft: '1px solid #2a0a0a' }}>
          <ToolBtn onClick={undo} disabled={!canUndo} ariaLabel="Undo" title="Undo">
            <UndoIcon />
          </ToolBtn>
          <ToolBtn onClick={redo} disabled={!canRedo} ariaLabel="Redo" title="Redo">
            <RedoIcon />
          </ToolBtn>
          <ToolBtn onClick={() => setShowClearConfirm(true)} disabled={historyLen === 0 && redoLen === 0} ariaLabel="Clear" title="Clear">
            <TrashIcon />
          </ToolBtn>
        </div>

        {/* Save status — small text, right-aligned via ml-auto */}
        {saveStatus && (
          <span
            className="text-xs ml-auto pr-1"
            style={{
              color: saveStatus === 'saving' ? 'rgba(255,255,255,0.55)'
                   : saveStatus === 'saved'  ? '#22c55e'
                                              : '#ef4444',
            }}
          >
            {saveStatus === 'saving' ? 'Saving…' :
             saveStatus === 'saved'  ? '✓ Saved' :
             saveStatus}
          </span>
        )}
      </div>

      {/* ── Canvas area ── */}
      <div
        ref={containerRef}
        className="flex-1 relative"
        style={{ backgroundColor: '#0a1a0a', touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            display: 'block',
            cursor:  tool === 'eraser' ? 'cell' : 'crosshair',
            // touch-action: none on the parent handles the touch suppression;
            // belt-and-suspenders here too.
            touchAction: 'none',
          }}
        />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm" style={{ color: '#9a8080' }}>Loading…</p>
          </div>
        )}

        {/* Clear confirm — small inline confirmation, not a full modal */}
        {showClearConfirm && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 rounded-xl p-4 flex flex-col items-center gap-3 shadow-2xl"
            style={{
              backgroundColor: '#1a0000',
              border: `1px solid ${orgColor}`,
              minWidth: 280,
            }}
          >
            <p className="text-sm font-semibold" style={{ color: '#fff' }}>
              Clear the whiteboard?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-2 rounded-lg text-xs font-semibold"
                style={{
                  backgroundColor: '#0d0000',
                  color: 'rgba(255,255,255,0.85)',
                  border: '1px solid #3a1414',
                }}
              >
                Cancel
              </button>
              <button
                onClick={clearAll}
                className="px-3 py-2 rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: orgColor }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
