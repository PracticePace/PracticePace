import { useState, useEffect } from 'react'
import {
  subscribe, getSnapshot,
  startPause, reset, jumpTo, next,
  setTimeTo, addMinute, subtractMinute,
  setActiveScript,
  setAutoAdvance, setAllowOverrun, setHornOnEnd, setWhistleAt60,
} from '../../lib/practiceTimer'

function pad(n) { return String(n).padStart(2, '0') }
function fmt(s) { return `${pad(Math.floor(Math.abs(s) / 60))}:${pad(Math.abs(s) % 60)}` }

function clockColor(left, total) {
  if (!total || total <= 0) return '#22c55e'
  const pct = left / total
  if (pct > 0.6) return '#22c55e'
  if (pct > 0.3) return '#f59e0b'
  return '#ef4444'
}

const TIME_PRESETS = [5, 10, 15, 20]

// ── Toggle button ─────────────────────────────────────────────────────────────
function ToggleBtn({ label, active, onColor = '#22c55e', onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
      style={{
        backgroundColor: active ? `${onColor}22` : '#110000',
        border:          `1px solid ${active ? onColor : '#2a0000'}`,
        color:           active ? onColor : '#4a2020',
      }}
    >
      <span
        className="w-7 h-4 rounded-full relative flex-shrink-0"
        style={{ backgroundColor: active ? onColor : '#2a0000' }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all"
          style={{ left: active ? '14px' : '2px' }}
        />
      </span>
      {label}
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PracticeSection({ activeScript, orgColor, backgroundUrl }) {

  // Subscribe to the singleton — re-render on every tick
  const [snap, setSnap] = useState(() => getSnapshot())
  useEffect(() => subscribe(setSnap), [])

  // Tell the singleton when the script prop changes (only resets if script changed)
  useEffect(() => {
    console.log('[ACTIVE] PracticeSection effect — pushing activeScript prop to timer singleton, id:', activeScript?.id ?? null, 'name:', activeScript?.name ?? null)
    setActiveScript(activeScript)
  }, [activeScript])

  // Derive display values from snapshot
  const {
    isRunning, hasStarted,
    secondsLeft, totalSeconds,
    currentDrillIdx,
    isOverrun, overrunSeconds,
    autoAdvance, allowOverrun, hornOnEnd, whistleAt60,
  } = snap

  const drills      = snap.activeScript?.drills ?? []
  const currentDrill = drills[currentDrillIdx]
  const nextDrill    = drills[currentDrillIdx + 1]
  const isLastDrill  = currentDrillIdx >= drills.length - 1

  const pct          = totalSeconds ? (secondsLeft / totalSeconds) * 100 : 0
  const color        = isOverrun ? '#ef4444' : clockColor(secondsLeft, totalSeconds)
  const isDone       = hasStarted && !isRunning && secondsLeft === 0 && !isOverrun && isLastDrill && drills.length > 0
  const clockDisplay = isOverrun ? `+${fmt(overrunSeconds)}` : fmt(secondsLeft)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      style={{
        backgroundImage:    backgroundUrl ? `url(${backgroundUrl})` : undefined,
        backgroundSize:     'cover',
        backgroundPosition: 'center',
      }}
    >
      {backgroundUrl && (
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(0,0,0,0.72)' }} />
      )}

      <div className="relative z-10 flex-1 flex flex-col overflow-hidden px-4 pb-2 gap-0">

        {/* ── 1. Script name + period dots ──────────────────────────────────── */}
        <div className="shrink-0 flex flex-col items-center gap-1.5 pt-2 pb-1">
          {snap.activeScript ? (
            <>
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#6a4040' }}>
                {snap.activeScript.name}
              </p>
              {drills.length <= 30 ? (
                <div className="flex gap-1.5 flex-wrap justify-center">
                  {drills.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => jumpTo(i)}
                      title={drills[i].name}
                      className="rounded-full transition-all"
                      style={{
                        width:           i === currentDrillIdx ? 10 : 7,
                        height:          i === currentDrillIdx ? 10 : 7,
                        backgroundColor: i <= currentDrillIdx ? orgColor : '#2a0000',
                        opacity:         i < currentDrillIdx ? 0.35 : 1,
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs font-semibold" style={{ color: '#6a4040' }}>
                  {currentDrillIdx + 1} / {drills.length}
                </p>
              )}
            </>
          ) : (
            <div className="text-center">
              <p className="font-bold text-white text-sm">Quick Timer</p>
              <p className="text-xs" style={{ color: '#9a8080' }}>
                Go to Scripts and tap Set Active to load a script.
              </p>
            </div>
          )}
        </div>

        {/* ── 2. Current segment name ───────────────────────────────────────── */}
        <div className="shrink-0 flex items-end justify-center pb-1" style={{ minHeight: 52 }}>
          {currentDrill ? (
            <h1
              className="text-center leading-none tracking-wide"
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize:   'clamp(2.8rem, 6.5vw, 5rem)',
                color:      '#ffffff',
                letterSpacing: '0.04em',
                textShadow: '0 2px 24px rgba(0,0,0,0.8)',
              }}
            >
              {currentDrill.name}
            </h1>
          ) : (
            <h1
              className="text-center leading-none tracking-wide"
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize:   'clamp(2rem, 5vw, 3.5rem)',
                color:      '#3a1818',
                letterSpacing: '0.04em',
              }}
            >
              No Script Active
            </h1>
          )}
        </div>

        {/* ── 3. Timer ──────────────────────────────────────────────────────── */}
        <div
          className="flex-1 min-h-0 flex items-center justify-center rounded-3xl"
          style={{
            border:     `3px solid ${color}`,
            boxShadow:  `0 0 80px ${color}55, inset 0 0 60px ${color}11`,
            transition: 'border-color 0.6s, box-shadow 0.6s',
          }}
        >
          <span
            className="font-mono font-black leading-none select-none"
            style={{
              fontSize:           'clamp(5.5rem, 20vw, 13rem)',
              color,
              textShadow:         `0 0 100px ${color}88`,
              transition:         'color 0.6s, text-shadow 0.6s',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {clockDisplay}
          </span>
        </div>

        {/* ── Progress bar ─────────────────────────────────────────────────── */}
        <div className="shrink-0 w-full rounded-full overflow-hidden mt-2" style={{ height: 5, backgroundColor: '#1a0000' }}>
          <div
            style={{
              height:          '100%',
              width:           `${Math.max(0, Math.min(100, pct))}%`,
              backgroundColor: color,
              borderRadius:    9999,
              transition:      'width 0.95s linear, background-color 0.6s',
            }}
          />
        </div>

        {/* ── 4. Divider ────────────────────────────────────────────────────── */}
        <div className="shrink-0 mt-2 mb-2 w-full" style={{ height: 1, backgroundColor: '#1a0000' }} />

        {/* ── 5. Next up ────────────────────────────────────────────────────── */}
        <div className="shrink-0 flex flex-col items-center gap-0.5" style={{ minHeight: 56 }}>
          {nextDrill ? (
            <>
              <p
                className="tracking-widest uppercase font-bold"
                style={{ fontSize: '0.75rem', color: '#ffffff', letterSpacing: '0.25em' }}
              >
                Next Up
              </p>
              <p
                className="text-center leading-tight"
                style={{
                  fontFamily:    "'Bebas Neue', sans-serif",
                  fontSize:      'clamp(1.8rem, 4vw, 3.2rem)',
                  color:         'rgba(255,255,255,0.85)',
                  letterSpacing: '0.04em',
                }}
              >
                {nextDrill.name}
              </p>
              <p
                className="font-mono font-bold"
                style={{ fontSize: 'clamp(0.9rem, 1.6vw, 1.1rem)', color: '#9a8080' }}
              >
                {fmt(nextDrill.duration ?? 0)}
              </p>
            </>
          ) : snap.activeScript && !isDone ? (
            <p
              className="tracking-widest uppercase font-bold"
              style={{ fontSize: '0.65rem', color: '#2a1010', letterSpacing: '0.16em' }}
            >
              Last Segment
            </p>
          ) : isDone ? (
            <p className="text-base font-black" style={{ color: '#22c55e' }}>
              ✓ Practice Complete!
            </p>
          ) : null}

          {isOverrun && (
            <p className="text-sm font-black animate-pulse mt-1" style={{ color: '#ef4444' }}>
              ⚠ OVERRUN — {fmt(overrunSeconds)} past end
            </p>
          )}
        </div>

        {/* ── 6 & 7. Control row ───────────────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-center gap-2 pt-1 pb-0.5 flex-wrap">

          {/* Prev */}
          <button
            onClick={() => currentDrillIdx > 0 && jumpTo(currentDrillIdx - 1)}
            disabled={currentDrillIdx === 0}
            title="Previous segment"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-xl disabled:opacity-20 transition-opacity"
            style={{
              border:          '1px solid #2a0000',
              color:           '#9a8080',
              backgroundColor: backgroundUrl ? 'rgba(17,0,0,0.85)' : '#110000',
            }}
          >
            ⏮
          </button>

          {/* Reset */}
          <button
            onClick={reset}
            title="Reset"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-xl transition-opacity"
            style={{
              border:          '1px solid #2a0000',
              color:           '#9a8080',
              backgroundColor: backgroundUrl ? 'rgba(17,0,0,0.85)' : '#110000',
            }}
          >
            ↺
          </button>

          {/* Start / Pause */}
          <button
            onClick={startPause}
            className="h-11 px-8 rounded-xl font-black text-white transition-all"
            style={{ backgroundColor: orgColor, minWidth: 130, fontSize: '1.1rem' }}
          >
            {isRunning ? '⏸ Pause' : isDone ? '✓ Done' : '▶ Start'}
          </button>

          {/* Next → blows horn + auto-starts next drill */}
          <button
            onClick={next}
            disabled={isLastDrill && !isRunning && secondsLeft === 0}
            className="h-11 px-5 rounded-xl font-black transition-all disabled:opacity-30"
            style={{
              backgroundColor: backgroundUrl ? 'rgba(26,0,0,0.90)' : '#110000',
              border:          `2px solid ${orgColor}`,
              color:           orgColor,
              fontSize:        '1rem',
            }}
          >
            Next →
          </button>

          {/* Divider */}
          <div className="w-px h-7 mx-1" style={{ backgroundColor: '#2a0000' }} />

          {/* Time hot buttons */}
          {TIME_PRESETS.map(m => {
            const secs     = m * 60
            const isActive = secondsLeft === secs && !isRunning
            return (
              <button
                key={m}
                onClick={() => setTimeTo(secs)}
                className="h-11 px-2.5 rounded-lg text-xs font-bold"
                style={{
                  backgroundColor: isActive ? `${orgColor}22` : '#110000',
                  border:          `1px solid ${isActive ? orgColor : '#2a0000'}`,
                  color:           isActive ? orgColor : '#9a8080',
                }}
              >
                {m}m
              </button>
            )
          })}

          <button
            onClick={subtractMinute}
            className="h-11 px-2.5 rounded-lg text-xs font-bold"
            style={{ backgroundColor: '#110000', border: '1px solid #2a0000', color: '#9a8080' }}
          >
            −1m
          </button>

          <button
            onClick={addMinute}
            className="h-11 px-2.5 rounded-lg text-xs font-bold"
            style={{ backgroundColor: '#110000', border: '1px solid #2a0000', color: '#9a8080' }}
          >
            +1m
          </button>
        </div>

        {/* ── 8. Coach toggles ─────────────────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-center gap-3 pb-1 flex-wrap">
          <ToggleBtn
            label="Auto-Advance"
            active={autoAdvance}
            onColor={orgColor}
            onClick={() => setAutoAdvance(!autoAdvance)}
          />
          <ToggleBtn
            label="Allow Overrun"
            active={allowOverrun}
            onColor="#ef4444"
            onClick={() => setAllowOverrun(!allowOverrun)}
          />
          <ToggleBtn
            label="Air Horn"
            active={hornOnEnd}
            onColor={orgColor}
            onClick={() => setHornOnEnd(!hornOnEnd)}
          />
          <ToggleBtn
            label="Whistle 1:00"
            active={whistleAt60}
            onColor={orgColor}
            onClick={() => setWhistleAt60(!whistleAt60)}
          />
        </div>

      </div>
    </div>
  )
}
