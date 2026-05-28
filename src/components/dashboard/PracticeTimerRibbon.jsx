// ── PracticeTimerRibbon ─────────────────────────────────────────────────────
// Thin 44 px tappable strip that sits between the Dashboard header and the
// tab content. Shows the current drill name + remaining time during a live
// practice so coaches can keep eyes on the clock while they're using
// Whiteboard, Video, Scoreboard, Scripts, etc. Tapping the strip jumps the
// active tab back to Practice.
//
// Why this works without any "lift state up" refactor:
// The practice timer state already lives in a module-level singleton
// (src/lib/practiceTimer.js) with its own setInterval. The countdown runs
// across tab switches regardless of which component is mounted. This
// component just SUBSCRIBES to that singleton — same pattern PracticeSection
// uses — so the ribbon and the full Practice screen always read the same
// underlying state. Tapping the ribbon to return to Practice has no
// discontinuity: the clock the coach saw in the ribbon is the same number
// PracticeSection renders on mount.
//
// Visibility rules (derived from spec):
//   • hide on the Practice tab — the full timer is already there
//   • hide on Settings — avoid clutter
//   • hide when no script is active or practice hasn't started yet
//     (pre-start phase)
//   • hide when the script has truly ended — last drill expired with no
//     overrun and no next drill (isDone). This covers the Complete and
//     Cleared arc phases at the singleton level, since both arise from
//     isDone going true.
//   • show in every other case: running, paused mid-drill, in overrun.
//
// Visual states:
//   • running       — Bebas Neue MM:SS in white, "● LIVE" accent in
//                     orgColor on the left
//   • paused        — MM:SS dimmed, "PAUSED" label appears, no LIVE dot
//   • overrun       — +MM:SS in red, "OVERRUN" label
//
// Props:
//   section   — current Dashboard section id ('practice', 'scripts', ...).
//               Used solely for the show/hide gate.
//   orgColor  — program brand color for the LIVE dot + bottom-border tint.
//   onTap     — fired when the coach taps the ribbon. Dashboard wires this
//               to setSection('practice').

import { useEffect, useState } from 'react'
import { subscribe, getSnapshot } from '../../lib/practiceTimer'

const HIDDEN_SECTIONS = new Set(['practice', 'settings'])

function fmt(secs) {
  const safe = Math.max(0, Math.floor(secs ?? 0))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PracticeTimerRibbon({ section, orgColor = '#cc1111', onTap }) {
  const [snap, setSnap] = useState(() => getSnapshot())
  useEffect(() => subscribe(setSnap), [])

  // ── Visibility gates ───────────────────────────────────────────────────────
  if (HIDDEN_SECTIONS.has(section)) return null

  const {
    activeScript, hasStarted, isRunning, secondsLeft,
    currentDrillIdx, isOverrun, overrunSeconds,
  } = snap

  if (!activeScript || !hasStarted) return null

  const drills      = activeScript.drills ?? []
  const isLastDrill = currentDrillIdx === drills.length - 1
  const isDone      = hasStarted && !isRunning && secondsLeft === 0
                      && !isOverrun && isLastDrill && drills.length > 0
  if (isDone) return null

  // ── Display values ─────────────────────────────────────────────────────────
  const drill     = drills[currentDrillIdx] ?? null
  const drillName = drill?.name ?? 'Practice'
  const timeText  = isOverrun ? `+${fmt(overrunSeconds)}` : fmt(secondsLeft)
  const paused    = !isRunning && !isOverrun

  const timeColor =
    isOverrun ? '#ef4444' :
    paused    ? '#9a8080' :
                '#ffffff'

  const statusLabel =
    isOverrun ? 'OVERRUN' :
    paused    ? 'PAUSED'  :
                null

  const statusColor = isOverrun ? '#ef4444' : '#9a8080'

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Return to Practice — ${drillName}, ${timeText}${paused ? ', paused' : ''}`}
      className="shrink-0 w-full flex items-center justify-between gap-3 px-4 transition-colors active:opacity-80"
      style={{
        height:          44,
        backgroundColor: '#110000',
        borderBottom:    `1px solid ${orgColor}55`,
        boxShadow:       `inset 0 -1px 0 ${orgColor}22`,
        color:           '#ffffff',
      }}
    >
      {/* Left: LIVE / status accent + drill name */}
      <div className="flex items-center gap-3 min-w-0">
        {!paused && !isOverrun && (
          <span
            className="font-semibold uppercase shrink-0"
            style={{
              fontSize:      10,
              letterSpacing: '0.16em',
              color:         orgColor,
            }}
          >
            ● LIVE
          </span>
        )}
        <span
          className="font-medium truncate text-left"
          style={{ fontSize: 13, color: '#e8d8d8' }}
        >
          {drillName}
        </span>
      </div>

      {/* Right: optional status label + MM:SS */}
      <div className="flex items-center gap-3 shrink-0">
        {statusLabel && (
          <span
            className="font-bold uppercase"
            style={{
              fontSize:      10,
              letterSpacing: '0.14em',
              color:         statusColor,
            }}
          >
            {statusLabel}
          </span>
        )}
        <span
          style={{
            fontFamily:    "'Bebas Neue', sans-serif",
            fontSize:      22,
            letterSpacing: '0.04em',
            color:         timeColor,
            lineHeight:    1,
          }}
        >
          {timeText}
        </span>
      </div>
    </button>
  )
}
