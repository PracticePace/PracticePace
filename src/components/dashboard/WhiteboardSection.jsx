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
// Order matters here — first color is the default selection, and the
// picker renders them left-to-right in this order. Black is first
// because the Blank background is white (an actual whiteboard); white
// moves to the end since it's now only useful on the dark sport
// surfaces (football green, basketball wood, etc.).
const COLORS = [
  { name: 'black',  hex: '#000000' },
  { name: 'red',    hex: '#ef4444' },
  { name: 'blue',   hex: '#3b82f6' },
  { name: 'green',  hex: '#22c55e' },
  { name: 'yellow', hex: '#facc15' },
  { name: 'white',  hex: '#ffffff' },
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
  // Actual whiteboard: pure white surface. Coaches with sport-specific
  // diagrams switch to a sport background; everything else is drawn on
  // a real whiteboard. Default pen color is now black to match (see
  // the COLORS array above).
  ctx.fillStyle = '#ffffff'
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

// Helper for backgrounds that are elongated rectangles (long axis ≫ short).
// On portrait viewports we rotate the canvas 90 ° so the long axis of the
// surface aligns with the long axis of the canvas — keeps proportions
// readable on iPad portrait. `paint(ctx, long, short)` receives the
// post-rotation dimensions (long ≥ short always).
function paintLandscape(ctx, w, h, paint) {
  const horizontal = w >= h
  ctx.save()
  if (!horizontal) {
    ctx.translate(w, 0)
    ctx.rotate(Math.PI / 2)
  }
  paint(ctx, horizontal ? w : h, horizontal ? h : w)
  ctx.restore()
}

// ── Basketball courts (clipboard / coaching-diagram style) ────────────────────
// White surface, black lines. Real NBA proportions in feet (94 × 50 full,
// 47 × 50 half) — see https://en.wikipedia.org/wiki/Basketball_court for the
// canonical dimensions used here. All features are drawn in "court feet"
// then scaled into the canvas via a precomputed scale factor; this keeps
// proportions correct on any viewport without per-feature percentage math.
//
// Both half-court and full-court are LANDSCAPE: long axis horizontal.
// Half-court is the LEFT HALF of the full-court — basket at left, center
// jump half-circle at the right edge.

function drawBasketballHalfCourtFeatures(ctx, cx, cy, scale, baselineFt, dir) {
  // dir = +1 → basket on the LEFT,  key extends to the RIGHT from baselineFt
  // dir = -1 → basket on the RIGHT, key extends to the LEFT  from baselineFt
  const basketFt   = baselineFt + dir * 5.25     // rim center
  const ftLineFt   = baselineFt + dir * 19       // free-throw line
  const backboardFt = baselineFt + dir * 4       // backboard line
  const keyMinFt   = Math.min(baselineFt, ftLineFt)
  const keyDepthFt = Math.abs(ftLineFt - baselineFt)

  // Outer key (16 ft wide × 19 ft deep) + inner lane (12 ft wide × 19 ft).
  // Two concentric rectangles give the modern NBA / college "wide painted
  // area with an inner lane" look the user spec'd.
  ctx.strokeRect(cx(keyMinFt), cy(-8), keyDepthFt * scale, 16 * scale)
  ctx.strokeRect(cx(keyMinFt), cy(-6), keyDepthFt * scale, 12 * scale)

  // Free-throw circle straddling the free-throw line.
  //   • Midcourt-side half (facing AWAY from basket) — SOLID
  //   • Basket-side half (facing TOWARD basket)      — DASHED
  // Coaching-diagram convention.
  const ftR = 6 * scale
  ctx.setLineDash([])
  ctx.beginPath()
  if (dir > 0) ctx.arc(cx(ftLineFt), cy(0), ftR, -Math.PI / 2,  Math.PI / 2)
  else         ctx.arc(cx(ftLineFt), cy(0), ftR,  Math.PI / 2, 3 * Math.PI / 2)
  ctx.stroke()

  ctx.setLineDash([1.2 * scale, 0.8 * scale])
  ctx.beginPath()
  if (dir > 0) ctx.arc(cx(ftLineFt), cy(0), ftR,  Math.PI / 2, 3 * Math.PI / 2)
  else         ctx.arc(cx(ftLineFt), cy(0), ftR, -Math.PI / 2,  Math.PI / 2)
  ctx.stroke()
  ctx.setLineDash([])

  // Three-point line: two straight corner sections (22 ft from baseline) +
  // an arc of radius 23.75 ft centered on the rim. The arc joins the
  // straights at y = ±22 ft.
  const threePtR = 23.75
  const cornerY  = 22
  const arcHalf  = Math.asin(cornerY / threePtR)
  const straightEndFt = basketFt + dir * Math.cos(arcHalf) * threePtR

  ctx.beginPath()
  ctx.moveTo(cx(baselineFt), cy(-cornerY)); ctx.lineTo(cx(straightEndFt), cy(-cornerY))
  ctx.moveTo(cx(baselineFt), cy( cornerY)); ctx.lineTo(cx(straightEndFt), cy( cornerY))
  ctx.stroke()

  ctx.beginPath()
  if (dir > 0) ctx.arc(cx(basketFt), cy(0), threePtR * scale, -arcHalf, arcHalf)
  else         ctx.arc(cx(basketFt), cy(0), threePtR * scale, Math.PI - arcHalf, Math.PI + arcHalf)
  ctx.stroke()

  // Backboard line — 6 ft wide, 4 ft from baseline
  ctx.beginPath()
  ctx.moveTo(cx(backboardFt), cy(-3)); ctx.lineTo(cx(backboardFt), cy(3))
  ctx.stroke()

  // Rim marker — small circle at the basket
  ctx.beginPath()
  ctx.arc(cx(basketFt), cy(0), 0.75 * scale, 0, Math.PI * 2)
  ctx.stroke()

  // Restricted area — dashed semicircle, 4 ft radius from basket,
  // opens TOWARD midcourt (away from baseline)
  ctx.setLineDash([0.7 * scale, 0.5 * scale])
  ctx.beginPath()
  if (dir > 0) ctx.arc(cx(basketFt), cy(0), 4 * scale, -Math.PI / 2,  Math.PI / 2)
  else         ctx.arc(cx(basketFt), cy(0), 4 * scale,  Math.PI / 2, 3 * Math.PI / 2)
  ctx.stroke()
  ctx.setLineDash([])

  // Lane block hash marks — 4 short ticks per side of the lane.
  // Real NBA marks are at 7 / 8 / 11 / 14 ft from baseline; we use
  // 6 / 9 / 12 / 15 for visual rhythm. Ticks extend outward from the
  // outer key edge.
  const tickLenFt = 0.8
  ctx.beginPath()
  for (const d of [6, 9, 12, 15]) {
    const tx = baselineFt + dir * d
    // Top lane edge (y = -8)
    ctx.moveTo(cx(tx), cy(-8)); ctx.lineTo(cx(tx), cy(-8 - tickLenFt))
    // Bottom lane edge (y = +8)
    ctx.moveTo(cx(tx), cy( 8)); ctx.lineTo(cx(tx), cy( 8 + tickLenFt))
  }
  ctx.stroke()
}

// Shared renderer for both half-court and full-court.
function drawBasketballCourt(ctx, w, h, isFullCourt) {
  const courtL = isFullCourt ? 94 : 47  // length in feet (long axis)
  const courtW = 50                      // width in feet  (short axis)

  // Background — pure white (clipboard / paper)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  // Fit court inside the canvas with a 6 % margin, preserving aspect.
  const marginRatio = 0.06
  const availW = w * (1 - 2 * marginRatio)
  const availH = h * (1 - 2 * marginRatio)
  const scale  = Math.min(availW / courtL, availH / courtW)

  const courtPxL = courtL * scale
  const courtPxW = courtW * scale
  const courtX0  = (w - courtPxL) / 2  // canvas x of court x=0 (left baseline / left edge)
  const courtMidY = h / 2              // canvas y of court y=0 (the centerline)

  // Coord converters: court feet → canvas px. Court x ∈ [0, courtL], y ∈ [-25, +25].
  const cx = (ftX) => courtX0  + ftX * scale
  const cy = (ftY) => courtMidY + ftY * scale

  // Line styling — black, ~3 px, rounded caps for a clean clipboard look.
  ctx.strokeStyle = '#000000'
  ctx.lineWidth   = Math.max(2, scale * 0.18)  // ≈ 0.18 ft → 3-4 px at typical sizes
  ctx.lineCap     = 'round'
  ctx.lineJoin    = 'round'

  // Outer court boundary
  ctx.strokeRect(cx(0), cy(-25), courtPxL, courtPxW)

  // Left-half features (basket on left)
  drawBasketballHalfCourtFeatures(ctx, cx, cy, scale, 0, +1)

  if (isFullCourt) {
    // Right-half features (basket on right, mirrored)
    drawBasketballHalfCourtFeatures(ctx, cx, cy, scale, courtL, -1)

    // Half-court line (vertical, bisecting the court)
    ctx.beginPath()
    ctx.moveTo(cx(courtL / 2), cy(-25))
    ctx.lineTo(cx(courtL / 2), cy( 25))
    ctx.stroke()

    // Center circle — full circle (6 ft radius), bisected by the
    // half-court line.
    ctx.beginPath()
    ctx.arc(cx(courtL / 2), cy(0), 6 * scale, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    // Half-court — show the LEFT half of the center circle on the right edge
    // (so it visually completes when you flip to a full-court mental model).
    ctx.beginPath()
    ctx.arc(cx(courtL), cy(0), 6 * scale, Math.PI / 2, 3 * Math.PI / 2)
    ctx.stroke()
  }

  // Coach's-box hash marks — two small ticks on each sideline near the
  // half-court line. For full-court the midcourt is at courtL/2; for
  // half-court it's at the right edge (where the half-court line lives).
  const midFt   = isFullCourt ? courtL / 2 : courtL
  const tickGap = 2     // ticks at ±2 ft from the centerline mark
  const tickLen = 0.8
  ctx.beginPath()
  for (const offset of [-tickGap, +tickGap]) {
    // Top sideline (y = -25), tick extends inward (downward)
    ctx.moveTo(cx(midFt + offset), cy(-25))
    ctx.lineTo(cx(midFt + offset), cy(-25 + tickLen))
    // Bottom sideline (y = +25), tick extends inward (upward)
    ctx.moveTo(cx(midFt + offset), cy( 25))
    ctx.lineTo(cx(midFt + offset), cy( 25 - tickLen))
  }
  ctx.stroke()
}

function drawBasketballHalfCourt(ctx, w, h) { drawBasketballCourt(ctx, w, h, false) }
function drawBasketballFullCourt(ctx, w, h) { drawBasketballCourt(ctx, w, h, true)  }

// ── Baseball / softball field ─────────────────────────────────────────────────
// Diamond with home plate at bottom-center, 2nd base directly above, foul
// lines extending out 45 ° from home. Outfield green, infield dirt brown.
function drawBaseballField(ctx, w, h) {
  ctx.fillStyle = '#2d8a3e' // outfield grass
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const homeY = h * 0.88
  // Base-to-base distance — limited by the shorter canvas dimension
  const S = Math.min(w * 0.42, h * 0.55)
  const inv = S / Math.sqrt(2)

  const home   = { x: cx,         y: homeY }
  const first  = { x: cx + inv,   y: homeY - inv }
  const second = { x: cx,         y: homeY - 2 * inv }
  const third  = { x: cx - inv,   y: homeY - inv }

  // Infield dirt polygon through the four bases
  ctx.fillStyle = '#a07840'
  ctx.beginPath()
  ctx.moveTo(home.x, home.y)
  ctx.lineTo(first.x, first.y)
  ctx.lineTo(second.x, second.y)
  ctx.lineTo(third.x, third.y)
  ctx.closePath()
  ctx.fill()

  // Foul lines — extend from home plate to the canvas edges at 45 °
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(1, w * 0.003)
  const lineLen = Math.max(w, h) * 1.5
  ctx.beginPath()
  ctx.moveTo(home.x, home.y); ctx.lineTo(home.x + lineLen, home.y - lineLen); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(home.x, home.y); ctx.lineTo(home.x - lineLen, home.y - lineLen); ctx.stroke()

  // Pitcher's mound — small dirt circle at the infield's geometric center
  const moundY = homeY - inv  // midway between home and 2nd
  ctx.fillStyle = '#a07840'
  ctx.beginPath(); ctx.arc(cx, moundY, S * 0.05, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(cx - S * 0.02, moundY - S * 0.005, S * 0.04, S * 0.01)

  // Bases — small white squares rotated 45 ° (diamond orientation)
  function drawBase(x, y) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = '#ffffff'
    const bs = S * 0.04
    ctx.fillRect(-bs / 2, -bs / 2, bs, bs)
    ctx.restore()
  }
  drawBase(home.x,   home.y)
  drawBase(first.x,  first.y)
  drawBase(second.x, second.y)
  drawBase(third.x,  third.y)
}

// ── Soccer pitch ──────────────────────────────────────────────────────────────
// Standard FIFA proportions (100 m × 64 m, ~1.56 : 1). Long axis horizontal.
function drawSoccerPitch(ctx, w, h) {
  ctx.fillStyle = '#2d8a3e' // pitch green (slightly different from football to
                            // help coaches tell them apart at a glance)
  ctx.fillRect(0, 0, w, h)

  paintLandscape(ctx, w, h, (ctx, long, short) => {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, long * 0.003)

    const m  = long * 0.04
    const fw = long  - m * 2
    const fh = short - m * 2
    const midX = m + fw / 2
    const midY = m + fh / 2

    // Touchlines + goal lines
    ctx.strokeRect(m, m, fw, fh)

    // Halfway line + center circle + center spot
    ctx.beginPath(); ctx.moveTo(midX, m); ctx.lineTo(midX, m + fh); ctx.stroke()
    ctx.beginPath(); ctx.arc(midX, midY, fh * 0.15, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(midX, midY, long * 0.004, 0, Math.PI * 2); ctx.fill()

    // Penalty boxes (large) + goal areas (small) on each end
    const pbW = fw * 0.14, pbH = fh * 0.6
    const gaW = fw * 0.055, gaH = fh * 0.28
    ctx.strokeRect(m,           midY - pbH / 2, pbW, pbH)
    ctx.strokeRect(m + fw - pbW, midY - pbH / 2, pbW, pbH)
    ctx.strokeRect(m,           midY - gaH / 2, gaW, gaH)
    ctx.strokeRect(m + fw - gaW, midY - gaH / 2, gaW, gaH)

    // Penalty spots
    ctx.beginPath(); ctx.arc(m + fw * 0.11,        midY, long * 0.004, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(m + fw - fw * 0.11,    midY, long * 0.004, 0, Math.PI * 2); ctx.fill()

    // Corner arcs
    const cr = fh * 0.02
    ctx.beginPath(); ctx.arc(m,       m,       cr, 0,           Math.PI / 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(m + fw, m,       cr, Math.PI / 2,  Math.PI);     ctx.stroke()
    ctx.beginPath(); ctx.arc(m,       m + fh, cr, -Math.PI / 2, 0);            ctx.stroke()
    ctx.beginPath(); ctx.arc(m + fw, m + fh, cr, Math.PI,      3 * Math.PI / 2); ctx.stroke()

    // Goals (outside the pitch, on each goal line)
    const gW = fh * 0.12, gD = fw * 0.012
    ctx.strokeRect(m - gD,  midY - gW / 2, gD, gW)
    ctx.strokeRect(m + fw,  midY - gW / 2, gD, gW)
  })
}

// ── Volleyball court ──────────────────────────────────────────────────────────
// 18 × 9 m (2 : 1). Net runs PERPENDICULAR to the long axis at midpoint.
function drawVolleyballCourt(ctx, w, h) {
  ctx.fillStyle = '#d4a373' // light wood / sport floor
  ctx.fillRect(0, 0, w, h)

  paintLandscape(ctx, w, h, (ctx, long, short) => {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, long * 0.004)

    const m  = long * 0.08  // generous margin (court is small)
    const fw = long  - m * 2
    const fh = short - m * 2
    const midX = m + fw / 2

    // Outer boundary + center line
    ctx.strokeRect(m, m, fw, fh)
    ctx.beginPath(); ctx.moveTo(midX, m); ctx.lineTo(midX, m + fh); ctx.stroke()

    // Attack lines — 3 m from center on each side. 3 / 9 (half-court depth) = ⅓.
    ctx.beginPath()
    ctx.moveTo(midX - fw / 6, m); ctx.lineTo(midX - fw / 6, m + fh)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(midX + fw / 6, m); ctx.lineTo(midX + fw / 6, m + fh)
    ctx.stroke()

    // Net — dashed line directly over the center line, extends beyond the
    // sidelines so it reads as "the net is here"
    ctx.setLineDash([long * 0.012, long * 0.008])
    ctx.lineWidth = Math.max(1, long * 0.005)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.moveTo(midX, m - fh * 0.08)
    ctx.lineTo(midX, m + fh + fh * 0.08)
    ctx.stroke()
    ctx.setLineDash([])
  })
}

// ── Tennis court ──────────────────────────────────────────────────────────────
// 23.77 × 10.97 m (~2.17 : 1) for doubles. Hard-court blue surface.
function drawTennisCourt(ctx, w, h) {
  ctx.fillStyle = '#3b7da8' // US Open–style hard-court blue
  ctx.fillRect(0, 0, w, h)

  paintLandscape(ctx, w, h, (ctx, long, short) => {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, long * 0.0035)

    const m  = long * 0.06
    const cw = long  - m * 2
    const ch = short - m * 2
    const midX = m + cw / 2
    const midY = m + ch / 2

    // Doubles court (full rectangle)
    ctx.strokeRect(m, m, cw, ch)

    // Singles sidelines — inset 1.37 / 10.97 ≈ 12.5 % of court height
    const slInset = ch * 0.125
    ctx.beginPath()
    ctx.moveTo(m,       m + slInset); ctx.lineTo(m + cw, m + slInset); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(m,       m + ch - slInset); ctx.lineTo(m + cw, m + ch - slInset); ctx.stroke()

    // Service lines — 6.4 m from net, net at center. 6.4 / (23.77/2) ≈ 0.54
    const svInset = (cw / 2) * 0.54
    ctx.beginPath()
    ctx.moveTo(midX - svInset, m + slInset); ctx.lineTo(midX - svInset, m + ch - slInset); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(midX + svInset, m + slInset); ctx.lineTo(midX + svInset, m + ch - slInset); ctx.stroke()

    // Center service line — between the two service lines
    ctx.beginPath()
    ctx.moveTo(midX - svInset, midY); ctx.lineTo(midX + svInset, midY); ctx.stroke()

    // Net — dashed line down the middle, extends slightly beyond the doubles sidelines
    ctx.setLineDash([long * 0.012, long * 0.008])
    ctx.lineWidth = Math.max(1, long * 0.005)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.moveTo(midX, m - ch * 0.05)
    ctx.lineTo(midX, m + ch + ch * 0.05)
    ctx.stroke()
    ctx.setLineDash([])
  })
}

// ── Running track (oval, 8 lanes) ─────────────────────────────────────────────
// "Stadium" shape: a rectangle with semicircular ends. 8 concentric lane
// lines. Inner field green; track surface red-orange. Start/finish line at
// the right straight.
function drawTrack(ctx, w, h) {
  // The "outside the track" area + inner field both share the same green —
  // simpler and reads fine as "track on grass."
  ctx.fillStyle = '#1f5d2a'
  ctx.fillRect(0, 0, w, h)

  paintLandscape(ctx, w, h, (ctx, long, short) => {
    const m = long * 0.04
    const oW = long  - m * 2 // outer width
    const oH = short - m * 2 // outer height
    const cx = m + oW / 2
    const cy = m + oH / 2

    // Lane count + width. Innermost lane sits oH * 0.55 / 2 from the centerline
    // on the short axis; lanes step outward in equal increments to the outer
    // boundary.
    const lanes = 8
    const outerR = oH / 2
    const innerR = oH * 0.55 / 2 // inner edge of track (= outer edge of field)
    const laneStep = (outerR - innerR) / lanes
    const straight = oW - 2 * outerR // length of the straightaways

    // Fill the track surface (the band between innerR and outerR)
    ctx.fillStyle = '#c25b3f'
    ctx.beginPath()
    // Outer stadium-shape path
    ctx.moveTo(cx - straight / 2, cy - outerR)
    ctx.lineTo(cx + straight / 2, cy - outerR)
    ctx.arc(cx + straight / 2, cy, outerR, -Math.PI / 2, Math.PI / 2)
    ctx.lineTo(cx - straight / 2, cy + outerR)
    ctx.arc(cx - straight / 2, cy, outerR, Math.PI / 2, 3 * Math.PI / 2)
    ctx.closePath()
    // Inner stadium-shape path (cuts a hole for the field)
    ctx.moveTo(cx + straight / 2, cy - innerR)
    ctx.lineTo(cx - straight / 2, cy - innerR)
    ctx.arc(cx - straight / 2, cy, innerR, -Math.PI / 2, Math.PI / 2, true)
    ctx.lineTo(cx + straight / 2, cy + innerR)
    ctx.arc(cx + straight / 2, cy, innerR, Math.PI / 2, 3 * Math.PI / 2, true)
    ctx.closePath()
    ctx.fill('evenodd')

    // Lane lines — one stadium shape per lane edge
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = Math.max(1, long * 0.0015)
    for (let i = 0; i <= lanes; i++) {
      const r = innerR + i * laneStep
      ctx.beginPath()
      ctx.moveTo(cx - straight / 2, cy - r)
      ctx.lineTo(cx + straight / 2, cy - r)
      ctx.arc(cx + straight / 2, cy, r, -Math.PI / 2, Math.PI / 2)
      ctx.lineTo(cx - straight / 2, cy + r)
      ctx.arc(cx - straight / 2, cy, r, Math.PI / 2, 3 * Math.PI / 2)
      ctx.closePath()
      ctx.stroke()
    }

    // Start/finish line — thick white line crossing all lanes at the top of
    // the right straight (a stand-in for the typical 100 m / 200 m finish).
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(2, long * 0.004)
    ctx.beginPath()
    ctx.moveTo(cx + straight / 2, cy - outerR)
    ctx.lineTo(cx + straight / 2, cy - innerR)
    ctx.stroke()
  })
}

const BACKGROUNDS = {
  blank:              drawBlank,
  football:           drawFootballField,
  basketball_half:    drawBasketballHalfCourt,
  basketball_full:    drawBasketballFullCourt,
  baseball:           drawBaseballField,
  soccer:             drawSoccerPitch,
  volleyball:         drawVolleyballCourt,
  tennis:             drawTennisCourt,
  track:              drawTrack,
}

// Toolbar dropdown options, in the order the user spec'd. All visible to all
// users regardless of program sport — no filtering.
const BACKGROUND_OPTIONS = [
  { value: 'blank',           label: 'Blank' },
  { value: 'football',        label: 'Football field' },
  { value: 'basketball_half', label: 'Basketball half-court' },
  { value: 'basketball_full', label: 'Basketball full-court' },
  { value: 'baseball',        label: 'Baseball/softball field' },
  { value: 'soccer',          label: 'Soccer pitch' },
  { value: 'volleyball',      label: 'Volleyball court' },
  { value: 'tennis',          label: 'Tennis court' },
  { value: 'track',           label: 'Track (oval, 8 lanes)' },
]

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
  // Default pen color is black — pairs with the white Blank background.
  // Coaches on sport backgrounds will tap a different swatch.
  const [color,      setColor]      = useState('#000000')
  const [thickness,  setThickness]  = useState(THICKNESSES[1].value)  // medium
  const [background, setBackground] = useState('blank')
  // Mirrored counts so the Undo / Redo buttons can disable themselves
  const [historyLen, setHistoryLen] = useState(0)
  const [redoLen,    setRedoLen]    = useState(0)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [isLoading,  setIsLoading]  = useState(true)
  const [saveStatus, setSaveStatus] = useState('')  // '' | 'saving' | 'saved' | error string

  // (Background options are no longer filtered by program sport — the
  // dropdown lists every surface and lets the coach pick. `sport` is still
  // accepted as a prop for backwards-compat but no longer read here.)

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
        {/* Background dropdown — replaces the previous two-button toggle.
            Native <select> on iOS opens the OS wheel picker, which is the
            right UX for a longer option list on touch devices. The toolbar
            container already uses flex-wrap so a wider dropdown wraps
            cleanly on iPad portrait without pushing other tools off-screen. */}
        <div className="flex items-center gap-1.5 pr-2 mr-1" style={{ borderRight: '1px solid #2a0a0a' }}>
          <label
            htmlFor="pp-wb-bg"
            className="text-xs uppercase tracking-widest"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            Background
          </label>
          <select
            id="pp-wb-bg"
            value={background}
            onChange={e => setBackground(e.target.value)}
            aria-label="Background"
            className="rounded-lg px-2.5 h-10 text-xs font-semibold outline-none cursor-pointer transition-colors"
            style={{
              backgroundColor: '#110000',
              color:           'rgba(255,255,255,0.9)',
              border:          '1px solid #3a1414',
              maxWidth:        180,
            }}
          >
            {BACKGROUND_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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

      {/* ── Canvas area ──
          Container background follows the canvas's Blank colour so the
          eraser — which uses destination-out compositing and therefore
          punches transparent holes through the canvas — doesn't reveal a
          contrasting backdrop during the active stroke. On Blank (white)
          the container is white. On sport backgrounds the canvas fills
          the area completely so the container stays its existing dark
          tone and is effectively invisible. */}
      <div
        ref={containerRef}
        className="flex-1 relative"
        style={{
          backgroundColor: background === 'blank' ? '#ffffff' : '#0a1a0a',
          touchAction: 'none',
        }}
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
            <p
              className="text-sm"
              style={{
                // Loading text needs a colour that reads against the
                // current canvas background — white on white wouldn't.
                color: background === 'blank' ? '#7a5050' : '#c8a0a0',
              }}
            >
              Loading…
            </p>
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
