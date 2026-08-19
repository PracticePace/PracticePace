import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import StadiumNoiseToggle from '../StadiumNoiseToggle'
import { useOrg } from '../../context/OrgContext'
import { canAdminister } from '../../lib/permissions'
import { playWhistle, playAirHorn } from '../../lib/sounds'

function pad(n) { return String(n).padStart(2, '0') }
function fmtClock(s) { return `${pad(Math.floor(Math.abs(s) / 60))}:${pad(Math.abs(s) % 60)}` }

// Parse "MM:SS" or "M:SS" typed input → seconds
function parseTimeInput(str) {
  const parts = str.split(':')
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10)
    const s = parseInt(parts[1], 10)
    if (!isNaN(m) && !isNaN(s) && s < 60) return m * 60 + s
  }
  const n = parseInt(str, 10)
  if (!isNaN(n)) return n
  return null
}

// ── Shared components ─────────────────────────────────────────────────────────

function Btn({ onClick, children, active, orgColor, danger, sm }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl font-bold transition-all ${sm ? 'px-3 py-2 text-xs' : 'px-5 py-3 text-sm'}`}
      style={{
        backgroundColor: danger ? '#cc1111' : active ? orgColor : '#1a0000',
        border:          `1px solid ${danger ? '#cc1111' : active ? orgColor : '#2a0000'}`,
        color:           (active || danger) ? '#fff' : '#9a8080',
      }}
    >
      {children}
    </button>
  )
}

// Large game clock — tappable to edit when paused
function GameClock({ secs, warn, running, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const inputRef              = useRef(null)

  function startEdit() {
    if (running) return
    setDraft(fmtClock(secs))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 10)
  }

  function commitEdit() {
    const parsed = parseTimeInput(draft)
    if (parsed !== null && parsed >= 0) onChange(parsed)
    setEditing(false)
    setDraft('')
  }

  function handleKey(e) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') { setEditing(false); setDraft('') }
  }

  const color = warn ? '#ef4444' : '#ffffff'

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKey}
        className="font-mono font-black text-center rounded-xl px-3 outline-none"
        style={{
          fontSize: 'clamp(3rem, 9vw, 7rem)',
          color,
          backgroundColor: '#1a0000',
          border:          `2px solid ${color}`,
          fontVariantNumeric: 'tabular-nums',
          width: 'clamp(200px, 35vw, 530px)',
        }}
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      title={running ? undefined : 'Tap to set time'}
      className="font-mono font-black leading-none transition-opacity"
      style={{
        fontSize:           'clamp(3rem, 9vw, 7rem)',
        color,
        fontVariantNumeric: 'tabular-nums',
        cursor:             running ? 'default' : 'text',
        opacity:            1,
      }}
    >
      {fmtClock(secs)}
    </button>
  )
}

// Small clock for play/shot clock — with inline +/- adjust (used by Basketball)
function AdjustableClock({ secs, warn, onAdjust }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onAdjust(-1)}
        className="w-8 h-8 rounded-lg text-base font-bold flex items-center justify-center"
        style={{ border: '1px solid #2a0000', color: '#9a8080' }}
      >
        −
      </button>
      <span
        className="font-mono font-black min-w-[3ch] text-center"
        style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', color: warn ? '#ef4444' : '#fff', fontVariantNumeric: 'tabular-nums' }}
      >
        {pad(secs)}
      </span>
      <button
        onClick={() => onAdjust(+1)}
        className="w-8 h-8 rounded-lg text-base font-bold flex items-center justify-center"
        style={{ border: '1px solid #2a0000', color: '#9a8080' }}
      >
        +
      </button>
    </div>
  )
}

// ── Shared amber colour for shot / play clocks ───────────────────────────────
const SHOT_AMBER = '#f59e0b'   // basketball shot clock
const PLAY_AMBER = '#ffa500'   // football play clock

// ── Football ──────────────────────────────────────────────────────────────────

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4', 'OT']
const DOWNS    = ['1ST', '2ND', '3RD', '4TH']

// Football score buttons: TD / FG / Safety / 2-pt / PAT
const FB_SCORES = [
  { pts: 6, label: 'TD'     },
  { pts: 3, label: 'FG'     },
  { pts: 2, label: 'Safety' },
  { pts: 2, label: '2-pt'   },
  { pts: 1, label: 'PAT'    },
]

// ── Editable team name label ──────────────────────────────────────────────────
function TeamLabel({ name, draft, editing, onStartEdit, onChange, onCommit, onCancel, orgColor }) {
  const inputRef = useRef(null)
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => onChange(e.target.value.toUpperCase().slice(0, 16))}
        onBlur={onCommit}
        onKeyDown={e => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel() }}
        className="flex-1 text-center text-sm font-black uppercase tracking-widest rounded-lg px-2 py-1 outline-none"
        style={{ backgroundColor: '#1a0000', border: `1px solid ${orgColor}`, color: '#fff', minWidth: 0 }}
        maxLength={16}
        autoFocus
      />
    )
  }

  return (
    <button
      onClick={onStartEdit}
      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1"
      style={{ border: '1px solid transparent', minWidth: 0 }}
    >
      <span className="text-sm font-black uppercase tracking-widest truncate" style={{ color: '#9a8080' }}>
        {name}
      </span>
      <span className="text-xs shrink-0" style={{ color: '#4a2020' }}>✎</span>
    </button>
  )
}

// ── Football scoreboard ───────────────────────────────────────────────────────
function FootballScoreboard({ orgColor, accountId, homeTeamName, awayTeamName, programName }) {

  // ── Timer state ─────────────────────────────────────────────────────────────
  const [gameSecs, setGameSecs]     = useState(15 * 60)
  const [gameRun, setGameRun]       = useState(false)
  const [playSecs, setPlaySecs]     = useState(40)
  const [playRun, setPlayRun]       = useState(false)
  const [playPreset, setPlayPreset] = useState(40)

  // ── Game state ───────────────────────────────────────────────────────────────
  const [quarter, setQuarter]   = useState(0)
  const [down, setDown]         = useState(0)
  const [distance, setDistance] = useState(10)
  const [ballOn, setBallOn]         = useState(25)
  const [editingBallOn, setEditingBallOn] = useState(false)

  // ── Score panels ─────────────────────────────────────────────────────────────
  const [homeScore, setHomeScore]       = useState(0)
  const [awayScore, setAwayScore]       = useState(0)
  const [homeTimeouts, setHomeTimeouts] = useState(3)
  const [awayTimeouts, setAwayTimeouts] = useState(3)

  // ── Editable team names ──────────────────────────────────────────────────────
  const defaultHome = ((homeTeamName ?? programName ?? 'HOME')).toUpperCase()
  const defaultAway = ((awayTeamName ?? 'AWAY')).toUpperCase()

  const [homeName, setHomeName] = useState(defaultHome)
  const [awayName, setAwayName] = useState(defaultAway)
  const [editingHome, setEditingHome] = useState(false)
  const [editingAway, setEditingAway] = useState(false)
  const [homeDraft, setHomeDraft] = useState('')
  const [awayDraft, setAwayDraft] = useState('')

  // Sync names when account data loads (async after mount)
  useEffect(() => {
    setHomeName(((homeTeamName ?? programName ?? 'HOME')).toUpperCase())
  }, [homeTeamName, programName])

  useEffect(() => {
    setAwayName(((awayTeamName ?? 'AWAY')).toUpperCase())
  }, [awayTeamName])

  // ── Timers ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameRun) return
    const id = setInterval(() => setGameSecs(s => { if (s <= 0) { setGameRun(false); return 0 } return s - 1 }), 1000)
    return () => clearInterval(id)
  }, [gameRun])

  useEffect(() => {
    if (!playRun) return
    const id = setInterval(() => setPlaySecs(s => { if (s <= 0) { setPlayRun(false); return 0 } return s - 1 }), 1000)
    return () => clearInterval(id)
  }, [playRun])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function resetPlay(p = playPreset) { setPlayRun(false); setPlaySecs(p); setPlayPreset(p) }

  const playWarn  = playSecs <= 5
  const amberNow  = playWarn ? '#ef4444' : PLAY_AMBER

  // Save team name to accounts table
  async function saveTeamName(field, value, revert) {
    if (!accountId) return
    try {
      const { error } = await supabase
        .from('accounts')
        .update({ [field]: value })
        .eq('id', accountId)
      if (error) {
        console.error('[Scoreboard] save team name failed:', error.message)
        revert()
      }
    } catch (err) {
      console.error('[Scoreboard] save team name error:', err.message)
      revert()
    }
  }

  // Home team name edit handlers
  function startEditHome() { setHomeDraft(homeName); setEditingHome(true) }
  function commitEditHome() {
    const val  = homeDraft.trim().toUpperCase().slice(0, 16) || homeName
    const prev = homeName
    setHomeName(val)
    setEditingHome(false)
    saveTeamName('home_team_name', val, () => setHomeName(prev))
  }
  function cancelEditHome() { setEditingHome(false); setHomeDraft('') }

  // Away team name edit handlers
  function startEditAway() { setAwayDraft(awayName); setEditingAway(true) }
  function commitEditAway() {
    const val  = awayDraft.trim().toUpperCase().slice(0, 16) || awayName
    const prev = awayName
    setAwayName(val)
    setEditingAway(false)
    saveTeamName('away_team_name', val, () => setAwayName(prev))
  }
  function cancelEditAway() { setEditingAway(false); setAwayDraft('') }

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col gap-2 p-3 overflow-hidden min-h-0">

      {/* ══ MAIN AREA: three equal-height columns ══════════════════════════════ */}
      <div className="flex-1 flex gap-3 min-h-0">

        {/* ── LEFT: Down / To Go / Ball On — LED scoreboard style ─────────── */}
        {/* min-h-0 lets the column shrink when the top row is tight —
            without it, the three flex-1 rows can push past the column's
            box and the overflow-hidden clips the BALL ON row at the
            bottom (that was the reported iPad Air landscape bug). With
            min-h-0 the rows equally divide whatever height is available;
            paired with the reduced digit clamp below they fit at every
            tested viewport, and if a future viewport is even tighter
            digits clip a few px inside their rows rather than a whole
            row disappearing. */}
        <div className="flex-1 flex flex-col rounded-2xl overflow-hidden min-h-0"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>

          {/* ROW 1: DOWN — tap digit to cycle 1 → 2 → 3 → 4 → 1 */}
          <div className="flex-1 flex items-center px-5 relative"
            style={{ borderBottom: '1px solid #2a0000' }}>
            <button
              onClick={() => setDown(d => (d + 1) % 4)}
              style={{
                fontFamily:         '"Courier New", "Roboto Mono", monospace',
                fontSize:           'clamp(4rem, 8vw, 6rem)',
                fontWeight:         700,
                color:              PLAY_AMBER,
                fontVariantNumeric: 'tabular-nums',
                lineHeight:         1,
                background:         'none',
                border:             'none',
                padding:            0,
                cursor:             'pointer',
                minWidth:           '1.1ch',
                textAlign:          'center',
                flexShrink:         0,
              }}
            >
              {down + 1}
            </button>
            <span
              style={{
                marginLeft:    '1rem',
                color:         '#ffffff',
                fontSize:      'clamp(1.5rem, 2.75vw, 2.25rem)',
                fontWeight:    500,
                letterSpacing: '1px',
                lineHeight:    1,
                textTransform: 'uppercase',
              }}
            >
              DOWN
            </span>
          </div>

          {/* ROW 2: TO GO */}
          <div className="flex-1 flex items-center px-5 relative"
            style={{ borderBottom: '1px solid #2a0000' }}>
            <span
              style={{
                fontFamily:         '"Courier New", "Roboto Mono", monospace',
                fontSize:           'clamp(4rem, 8vw, 6rem)',
                fontWeight:         700,
                color:              PLAY_AMBER,
                fontVariantNumeric: 'tabular-nums',
                lineHeight:         1,
                minWidth:           '2.2ch',
                textAlign:          'right',
                flexShrink:         0,
              }}
            >
              {distance}
            </span>
            <span
              style={{
                marginLeft:    '1rem',
                color:         '#ffffff',
                fontSize:      'clamp(1.5rem, 2.75vw, 2.25rem)',
                fontWeight:    500,
                letterSpacing: '1px',
                lineHeight:    1,
                textTransform: 'uppercase',
              }}
            >
              TO GO
            </span>
            {/* −/+ steppers tucked in bottom-right corner. Sized to
                Apple HIG's 44pt tap-target minimum for iPad courtside
                use — with a real background lift and white glyphs so a
                coach glancing away from the field can still find and
                hit them without having to look. Sized down from an
                earlier 56×56 pass which was tap-friendly but visually
                crowded the amber TO GO / BALL ON digits. */}
            <div className="absolute bottom-2 right-4 flex gap-2">
              <button
                onClick={() => setDistance(d => Math.max(1, d - 1))}
                aria-label="Decrease yards to go"
                className="flex items-center justify-center rounded-lg font-bold transition-opacity active:opacity-70"
                style={{
                  width:           44,
                  height:          44,
                  border:          '1px solid #4a1010',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color:           '#ffffff',
                  fontSize:        '1.4rem',
                  lineHeight:      1,
                }}
              >−</button>
              <button
                onClick={() => setDistance(d => Math.min(99, d + 1))}
                aria-label="Increase yards to go"
                className="flex items-center justify-center rounded-lg font-bold transition-opacity active:opacity-70"
                style={{
                  width:           44,
                  height:          44,
                  border:          '1px solid #4a1010',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color:           '#ffffff',
                  fontSize:        '1.4rem',
                  lineHeight:      1,
                }}
              >+</button>
            </div>
          </div>

          {/* ROW 3: BALL ON */}
          <div className="flex-1 flex items-center px-5 relative">
            {editingBallOn ? (
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                defaultValue={String(ballOn)}
                onFocus={e => e.target.select()}
                onBlur={e => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 1 && v <= 99) setBallOn(v)
                  setEditingBallOn(false)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.currentTarget.blur() }
                  if (e.key === 'Escape') setEditingBallOn(false)
                }}
                style={{
                  fontFamily:         '"Courier New", "Roboto Mono", monospace',
                  fontSize:           'clamp(4rem, 8vw, 6rem)',
                  fontWeight:         700,
                  color:              PLAY_AMBER,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight:         1,
                  width:              '2.5ch',
                  textAlign:          'center',
                  background:         'none',
                  border:             'none',
                  borderBottom:       `2px solid ${PLAY_AMBER}`,
                  outline:            'none',
                  flexShrink:         0,
                  padding:            0,
                }}
              />
            ) : (
              <button
                onClick={() => setEditingBallOn(true)}
                style={{
                  fontFamily:         '"Courier New", "Roboto Mono", monospace',
                  fontSize:           'clamp(4rem, 8vw, 6rem)',
                  fontWeight:         700,
                  color:              PLAY_AMBER,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight:         1,
                  minWidth:           '2.2ch',
                  textAlign:          'right',
                  flexShrink:         0,
                  background:         'none',
                  border:             'none',
                  padding:            0,
                  cursor:             'text',
                }}
              >
                {ballOn}
              </button>
            )}
            <span
              style={{
                marginLeft:    '1rem',
                color:         '#ffffff',
                fontSize:      'clamp(1.5rem, 2.75vw, 2.25rem)',
                fontWeight:    500,
                letterSpacing: '1px',
                lineHeight:    1,
                textTransform: 'uppercase',
              }}
            >
              BALL ON
            </span>
            {/* −/+ steppers tucked in bottom-right corner. Matches the
                TO GO steppers above (44×44, white glyph, subtle bg
                lift) for consistent iPad courtside tap targets. */}
            <div className="absolute bottom-2 right-4 flex gap-2">
              <button
                onClick={() => setBallOn(b => Math.max(1, b - 1))}
                aria-label="Decrease ball on"
                className="flex items-center justify-center rounded-lg font-bold transition-opacity active:opacity-70"
                style={{
                  width:           44,
                  height:          44,
                  border:          '1px solid #4a1010',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color:           '#ffffff',
                  fontSize:        '1.4rem',
                  lineHeight:      1,
                }}
              >−</button>
              <button
                onClick={() => setBallOn(b => Math.min(99, b + 1))}
                aria-label="Increase ball on"
                className="flex items-center justify-center rounded-lg font-bold transition-opacity active:opacity-70"
                style={{
                  width:           44,
                  height:          44,
                  border:          '1px solid #4a1010',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color:           '#ffffff',
                  fontSize:        '1.4rem',
                  lineHeight:      1,
                }}
              >+</button>
            </div>
          </div>
        </div>

        {/* ── CENTER: Game clock + controls ────────────────────────────────── */}
        {/* min-h-0 + overflow-hidden keep the column's shrink-0 Start/Reset
            row visible on tight viewports: the flex-1 game clock display
            below can shrink (huge digit vertically trims a few pixels)
            rather than pushing the Start button down past the column's
            box, where the opaque HOME/AWAY score panels below would paint
            over it. The LEFT column already has overflow-hidden for the
            same reason; this brings the center + right columns in line. */}
        <div className="flex-[1.4] flex flex-col gap-2 rounded-2xl px-4 py-4 min-h-0 overflow-hidden"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>

          {/* Quarter pills */}
          <div className="shrink-0 flex gap-1.5">
            {QUARTERS.map((q, i) => (
              <button
                key={q}
                onClick={() => { setQuarter(i); setGameSecs(15 * 60); setGameRun(false) }}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  backgroundColor: quarter === i ? `${orgColor}22` : '#1a0000',
                  border:          `1px solid ${quarter === i ? orgColor : '#2a0000'}`,
                  color:           quarter === i ? orgColor         : '#5a3030',
                }}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Game clock — flex-1 centered. min-h-0 lets this box shrink
              below the clamp()-driven digit's intrinsic 144px min height
              on tight viewports; overflow-hidden trims a few pixels off
              the top/bottom of the digit rather than pushing shrink-0
              siblings (SET CLOCK / Start-Reset) out past the column. */}
          <div className="flex-1 flex flex-col items-center justify-center gap-1 min-h-0 overflow-hidden">
            <GameClock
              secs={gameSecs}
              warn={gameSecs <= 60}
              running={gameRun}
              onChange={setGameSecs}
            />
            {!gameRun && (
              <span className="text-xs" style={{ color: '#5a3030' }}>tap to set time</span>
            )}
          </div>

          {/* SET CLOCK presets */}
          <div className="shrink-0 flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-widest text-center"
              style={{ color: '#5a2828' }}>Set Clock</span>
            <div className="flex gap-1.5 flex-wrap justify-center">
              {[[15, 0], [10, 0], [5, 0], [2, 0], [1, 0], [0, 30]].map(([m, s]) => (
                <button
                  key={`${m}:${s}`}
                  onClick={() => { setGameRun(false); setGameSecs(m * 60 + s) }}
                  className="px-3 py-2 rounded-lg text-xs font-bold"
                  style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#9a8080' }}
                >
                  {m}:{pad(s)}
                </button>
              ))}
            </div>
          </div>

          {/* Start / Reset */}
          <div className="shrink-0 flex gap-2">
            <button
              onClick={() => setGameRun(r => !r)}
              className="flex-[2] py-3 rounded-xl text-sm font-black text-white"
              style={{ backgroundColor: orgColor }}
            >
              {gameRun ? '⏸ Pause' : '▶ Start'}
            </button>
            <button
              onClick={() => { setGameRun(false); setGameSecs(15 * 60) }}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ border: '1px solid #2a0000', color: '#9a8080' }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* ── RIGHT: Play clock ─────────────────────────────────────────────── */}
        {/* Same min-h-0 + overflow-hidden protection as the center column
            above — keeps the shrink-0 Start/Pause row visible on tight
            viewports by letting the flex-1 big-number area shrink. */}
        <div
          className="flex-1 flex flex-col items-center gap-3 rounded-2xl px-4 py-4 min-h-0 overflow-hidden"
          style={{
            backgroundColor: '#0d0800',
            border:    `2px solid ${amberNow}44`,
            boxShadow: `0 0 24px ${amberNow}1a`,
          }}
        >
          {/* Label */}
          <span
            className="shrink-0 text-xs font-bold uppercase tracking-widest"
            style={{ color: `${amberNow}99` }}
          >
            Play Clock
          </span>

          {/* Big amber number. STRUCTURAL FIX (3rd attempt at this bug):
              two things had to change here at the container/line-box
              level — font-size tweaks alone couldn't fix it:
                (a) inner overflow-hidden REMOVED — the outer column
                    still has overflow-hidden as the safety belt, so
                    worst-case the digit paints freely within its own
                    flex-1 area but still can't escape the amber frame.
                (b) leading-none → leading-tight (line-height 1.25)
                    so the line-box contains font-metric ascender /
                    descender overshoot rather than letting it render
                    outside and get clipped by (the old) (a).
              Kept: min-h-0 (layout can still shrink); the clamp size;
              font family/weight/color. */}
          <div className="flex-1 flex items-center justify-center min-h-0">
            <span
              className="font-black font-mono leading-tight"
              style={{
                fontSize:           'clamp(6rem, 13vw, 9rem)',
                color:              amberNow,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pad(playSecs)}
            </span>
          </div>

          {/* Nudge − / + */}
          <div className="shrink-0 flex items-center gap-4">
            <button
              onClick={() => { setPlayRun(false); setPlaySecs(s => Math.max(0, s - 1)) }}
              className="w-12 h-12 rounded-xl text-xl font-bold flex items-center justify-center"
              style={{ border: `2px solid ${amberNow}44`, color: `${amberNow}88` }}
            >−</button>
            <button
              onClick={() => { setPlayRun(false); setPlaySecs(s => Math.min(60, s + 1)) }}
              className="w-12 h-12 rounded-xl text-xl font-bold flex items-center justify-center"
              style={{ border: `2px solid ${amberNow}44`, color: `${amberNow}88` }}
            >+</button>
          </div>

          {/* Preset pills: 40s / 25s / Rst */}
          <div className="shrink-0 flex gap-2 w-full">
            {[40, 25].map(p => (
              <button
                key={p}
                onClick={() => resetPlay(p)}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  backgroundColor: playPreset === p ? `${PLAY_AMBER}22` : '#1a0d00',
                  border:          `1px solid ${playPreset === p ? PLAY_AMBER : '#3a2000'}`,
                  color:           playPreset === p ? PLAY_AMBER          : `${PLAY_AMBER}55`,
                }}
              >
                {p}s
              </button>
            ))}
            <button
              onClick={() => resetPlay(playPreset)}
              className="flex-1 py-2 rounded-xl text-xs font-bold"
              style={{ border: '1px solid #3a2000', color: `${PLAY_AMBER}55` }}
            >
              Rst
            </button>
          </div>

          {/* Start / Pause */}
          <button
            onClick={() => setPlayRun(r => !r)}
            className="shrink-0 w-full py-3 rounded-xl text-sm font-black"
            style={{
              backgroundColor: `${amberNow}22`,
              border:          `2px solid ${amberNow}`,
              color:           amberNow,
            }}
          >
            {playRun ? '⏸ Pause' : '▶ Start'}
          </button>
        </div>
      </div>

      {/* ══ BOTTOM ROW: Score panels ════════════════════════════════════════════ */}
      <div className="shrink-0 flex gap-3">
        {/* HOME panel */}
        <div className="flex-1 flex flex-col rounded-2xl px-4 py-3 overflow-hidden"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>

          <div className="shrink-0 flex items-center justify-between gap-2 mb-1">
            <TeamLabel
              name={homeName}
              draft={homeDraft}
              editing={editingHome}
              onStartEdit={startEditHome}
              onChange={setHomeDraft}
              onCommit={commitEditHome}
              onCancel={cancelEditHome}
              orgColor={orgColor}
            />
            {/* Timeout dots */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs" style={{ color: '#4a2020' }}>TO</span>
              {[0, 1, 2].map(i => (
                <button
                  key={i}
                  onClick={() => setHomeTimeouts(t => i < t ? Math.max(0, t - 1) : Math.min(3, t + 1))}
                  className="w-4 h-4 rounded-full transition-all"
                  style={{ backgroundColor: i < homeTimeouts ? orgColor : '#2a0000' }}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center py-1">
            <span
              className="font-black text-white select-none"
              style={{ fontSize: 'clamp(3.5rem, 7vw, 5.5rem)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
            >
              {homeScore}
            </span>
          </div>

          <div className="shrink-0 flex gap-1.5">
            {FB_SCORES.map(({ pts, label }) => (
              <button
                key={label}
                onClick={() => setHomeScore(s => Math.max(0, s + pts))}
                className="flex-1 flex flex-col items-center justify-center rounded-xl font-black py-2"
                style={{
                  backgroundColor: `${orgColor}22`,
                  border:          `2px solid ${orgColor}`,
                  color:            orgColor,
                }}
              >
                <span style={{ fontSize: '1rem',   lineHeight: 1   }}>+{pts}</span>
                <span style={{ fontSize: '0.5rem', lineHeight: 1.5, color: `${orgColor}99` }}>{label}</span>
              </button>
            ))}
            <button
              onClick={() => setHomeScore(s => Math.max(0, s - 1))}
              className="flex items-center justify-center rounded-xl font-bold px-2"
              style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#6a4040', fontSize: '0.8rem' }}
            >
              -1
            </button>
          </div>
        </div>

        {/* AWAY panel */}
        <div className="flex-1 flex flex-col rounded-2xl px-4 py-3 overflow-hidden"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>

          <div className="shrink-0 flex items-center justify-between gap-2 mb-1">
            <TeamLabel
              name={awayName}
              draft={awayDraft}
              editing={editingAway}
              onStartEdit={startEditAway}
              onChange={setAwayDraft}
              onCommit={commitEditAway}
              onCancel={cancelEditAway}
              orgColor={orgColor}
            />
            {/* Timeout dots */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs" style={{ color: '#4a2020' }}>TO</span>
              {[0, 1, 2].map(i => (
                <button
                  key={i}
                  onClick={() => setAwayTimeouts(t => i < t ? Math.max(0, t - 1) : Math.min(3, t + 1))}
                  className="w-4 h-4 rounded-full transition-all"
                  style={{ backgroundColor: i < awayTimeouts ? orgColor : '#2a0000' }}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center py-1">
            <span
              className="font-black text-white select-none"
              style={{ fontSize: 'clamp(3.5rem, 7vw, 5.5rem)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
            >
              {awayScore}
            </span>
          </div>

          <div className="shrink-0 flex gap-1.5">
            {FB_SCORES.map(({ pts, label }) => (
              <button
                key={label}
                onClick={() => setAwayScore(s => Math.max(0, s + pts))}
                className="flex-1 flex flex-col items-center justify-center rounded-xl font-black py-2"
                style={{
                  backgroundColor: `${orgColor}22`,
                  border:          `2px solid ${orgColor}`,
                  color:            orgColor,
                }}
              >
                <span style={{ fontSize: '1rem',   lineHeight: 1   }}>+{pts}</span>
                <span style={{ fontSize: '0.5rem', lineHeight: 1.5, color: `${orgColor}99` }}>{label}</span>
              </button>
            ))}
            <button
              onClick={() => setAwayScore(s => Math.max(0, s - 1))}
              className="flex items-center justify-center rounded-xl font-bold px-2"
              style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#6a4040', fontSize: '0.8rem' }}
            >
              -1
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}

// ── Basketball ────────────────────────────────────────────────────────────────

const PERIODS_Q = ['Q1', 'Q2', 'Q3', 'Q4', 'OT']
const PERIODS_H = ['H1', 'H2', 'OT']

function BasketballScoreboard({ orgColor }) {
  const [home, setHome] = useState({ name: 'HOME', score: 0, fouls: 0 })
  const [away, setAway] = useState({ name: 'AWAY', score: 0, fouls: 0 })
  const [period, setPeriod]         = useState(0)
  const [periodType, setPeriodType] = useState('quarters')
  const [possession, setPossession] = useState(null)
  const [gameSecs, setGameSecs]     = useState(10 * 60)
  const [gameRun, setGameRun]       = useState(false)
  const [shotSecs, setShotSecs]     = useState(35)
  const [shotRun, setShotRun]       = useState(false)
  const [shotPreset, setShotPreset] = useState(35)

  const pLabels = periodType === 'halves' ? PERIODS_H : PERIODS_Q
  const pDur    = periodType === 'halves' ? 20 * 60   : 10 * 60

  useEffect(() => {
    if (!gameRun) return
    const id = setInterval(() => setGameSecs(s => { if (s <= 0) { setGameRun(false); return 0 } return s - 1 }), 1000)
    return () => clearInterval(id)
  }, [gameRun])

  useEffect(() => {
    if (!shotRun) return
    const id = setInterval(() => setShotSecs(s => { if (s <= 0) { setShotRun(false); return 0 } return s - 1 }), 1000)
    return () => clearInterval(id)
  }, [shotRun])

  function resetShot(p = shotPreset) { setShotRun(false); setShotSecs(p); setShotPreset(p) }
  function adj(setTeam, pts) { setTeam(t => ({ ...t, score: Math.max(0, t.score + pts) })) }

  // ── Sub-components ───────────────────────────────────────────────────────────
  const ScoreButtons = ({ setTeam }) => (
    <div className="flex gap-2 w-full">
      {[
        { pts: 1, label: 'FT'  },
        { pts: 2, label: '2pt' },
        { pts: 3, label: '3pt' },
      ].map(({ pts, label }) => (
        <button
          key={pts}
          onClick={() => adj(setTeam, pts)}
          className="flex-1 flex flex-col items-center justify-center rounded-xl font-black py-3"
          style={{
            backgroundColor: `${orgColor}22`,
            border:          `2px solid ${orgColor}`,
            color:            orgColor,
          }}
        >
          <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>+{pts}</span>
          <span style={{ fontSize: '0.65rem', lineHeight: 1.4, color: `${orgColor}99` }}>{label}</span>
        </button>
      ))}
      <button
        onClick={() => adj(setTeam, -1)}
        className="flex items-center justify-center rounded-xl font-bold px-3"
        style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#6a4040', fontSize: '0.85rem' }}
      >
        -1
      </button>
    </div>
  )

  const FoulCounter = ({ team, setTeam }) => {
    const bonus = team.fouls >= 7
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => setTeam(t => ({ ...t, fouls: Math.max(0, t.fouls - 1) }))}
          className="w-8 h-8 rounded-lg text-sm font-bold" style={{ border: '1px solid #2a0000', color: '#9a8080' }}>−</button>
        <div className="text-center" style={{ minWidth: 48 }}>
          <div className="font-black text-base" style={{ color: bonus ? SHOT_AMBER : '#fff', fontVariantNumeric: 'tabular-nums' }}>{team.fouls}</div>
          <div className="text-xs font-bold" style={{ color: bonus ? SHOT_AMBER : '#4a2020' }}>{bonus ? 'BONUS' : 'FOULS'}</div>
        </div>
        <button onClick={() => setTeam(t => ({ ...t, fouls: t.fouls + 1 }))}
          className="w-8 h-8 rounded-lg text-sm font-bold" style={{ border: '1px solid #2a0000', color: '#9a8080' }}>+</button>
      </div>
    )
  }

  const shotWarn = shotSecs <= 5

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col gap-2 p-3 overflow-hidden min-h-0">

      {/* ── ROW 1: Shot clock LEFT | Game clock CENTER | Period controls RIGHT ── */}
      <div className="shrink-0 flex gap-3 items-stretch">

        {/* Shot clock box — left */}
        <div className="flex flex-col items-center justify-between rounded-2xl px-4 py-3 shrink-0"
          style={{
            backgroundColor: '#0d0800',
            border:    `2px solid ${shotWarn ? '#ef4444' : SHOT_AMBER}44`,
            boxShadow: shotWarn ? '0 0 16px #ef444433' : `0 0 16px ${SHOT_AMBER}22`,
            minWidth: 160,
          }}>
          <span className="text-xs font-bold uppercase tracking-widest"
            style={{ color: shotWarn ? '#ef4444' : `${SHOT_AMBER}99` }}>
            Shot Clock
          </span>
          <div className="font-black font-mono leading-none"
            style={{ fontSize: 'clamp(3rem, 8vw, 4.5rem)', color: shotWarn ? '#ef4444' : SHOT_AMBER, fontVariantNumeric: 'tabular-nums' }}>
            {pad(shotSecs)}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShotRun(false); setShotSecs(s => Math.max(0, s - 1)) }}
              className="w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center"
              style={{ border: '1px solid #3a2000', color: `${SHOT_AMBER}88` }}>−</button>
            <button onClick={() => { setShotRun(false); setShotSecs(s => Math.min(35, s + 1)) }}
              className="w-7 h-7 rounded-lg text-sm font-bold flex items-center justify-center"
              style={{ border: '1px solid #3a2000', color: `${SHOT_AMBER}88` }}>+</button>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-center">
            {[35, 24, 14].map(p => (
              <button key={p} onClick={() => resetShot(p)}
                className="px-2 py-1 rounded-lg text-xs font-bold transition-all"
                style={{
                  backgroundColor: shotPreset === p ? `${SHOT_AMBER}22` : '#1a0d00',
                  border:          `1px solid ${shotPreset === p ? SHOT_AMBER : '#3a2000'}`,
                  color:           shotPreset === p ? SHOT_AMBER : `${SHOT_AMBER}55`,
                }}>
                {p}s
              </button>
            ))}
            <button onClick={() => resetShot(shotPreset)}
              className="px-2 py-1 rounded-lg text-xs font-bold"
              style={{ border: '1px solid #3a2000', color: `${SHOT_AMBER}55` }}>
              Rst
            </button>
          </div>
          <button
            onClick={() => setShotRun(r => !r)}
            className="w-full py-2 rounded-xl text-sm font-bold"
            style={{ backgroundColor: shotWarn ? '#ef444422' : `${SHOT_AMBER}22`,
              border: `1px solid ${shotWarn ? '#ef4444' : SHOT_AMBER}`,
              color: shotWarn ? '#ef4444' : SHOT_AMBER }}
          >
            {shotRun ? '⏸ Pause' : '▶ Start'}
          </button>
        </div>

        {/* Game clock — center, dominant */}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-3"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>
          <GameClock secs={gameSecs} warn={gameSecs <= 60} running={gameRun} onChange={setGameSecs} />
          {!gameRun && (
            <span className="text-xs" style={{ color: '#6a4040' }}>tap to set time</span>
          )}
        </div>

        {/* Period controls — right */}
        <div className="flex flex-col items-center justify-between gap-2 rounded-2xl px-4 py-3 shrink-0"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000', minWidth: 160 }}>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9a8080' }}>
            Period
          </span>
          <div className="flex gap-1.5">
            {['quarters', 'halves'].map(t => (
              <button key={t}
                onClick={() => { setPeriodType(t); setPeriod(0); setGameSecs(t === 'halves' ? 20 * 60 : 10 * 60); setGameRun(false) }}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  backgroundColor: periodType === t ? `${orgColor}22` : '#1a0000',
                  border:          `1px solid ${periodType === t ? orgColor : '#2a0000'}`,
                  color:           periodType === t ? orgColor : '#9a8080',
                }}>
                {t === 'quarters' ? 'Qtrs' : 'Halves'}
              </button>
            ))}
          </div>
          <select
            value={period}
            onChange={e => { setPeriod(Number(e.target.value)); setGameSecs(pDur); setGameRun(false) }}
            className="w-full rounded-xl px-3 py-2.5 text-sm font-bold outline-none text-center"
            style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#fff' }}
          >
            {pLabels.map((l, i) => <option key={l} value={i}>{l}</option>)}
          </select>
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-widest" style={{ color: '#4a2020' }}>Ball</span>
            <button onClick={() => setPossession(p => p === 'home' ? null : 'home')}
              className="px-2 py-1 rounded-lg text-xs font-bold transition-all"
              style={{
                backgroundColor: possession === 'home' ? `${orgColor}22` : '#1a0000',
                border: `1px solid ${possession === 'home' ? orgColor : '#2a0000'}`,
                color:  possession === 'home' ? orgColor : '#4a2020',
              }}>
              {home.name || 'HOME'}
            </button>
            <button onClick={() => setPossession(p => p === 'away' ? null : 'away')}
              className="px-2 py-1 rounded-lg text-xs font-bold transition-all"
              style={{
                backgroundColor: possession === 'away' ? `${orgColor}22` : '#1a0000',
                border: `1px solid ${possession === 'away' ? orgColor : '#2a0000'}`,
                color:  possession === 'away' ? orgColor : '#4a2020',
              }}>
              {away.name || 'AWAY'}
            </button>
          </div>
        </div>
      </div>

      {/* ── ROW 2: Score panels ── */}
      <div className="flex-1 flex gap-3 min-h-0">
        {[['home', home, setHome], ['away', away, setAway]].map(([side, team, setTeam]) => (
          <div key={side} className="flex-1 flex flex-col rounded-2xl p-4 overflow-hidden"
            style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>
            <input
              value={team.name}
              onChange={e => setTeam(t => ({ ...t, name: e.target.value }))}
              className="shrink-0 text-center text-xs font-black uppercase tracking-widest rounded-xl px-3 py-2 outline-none w-full"
              style={{ backgroundColor: 'transparent', border: '1px solid #2a0000', color: '#9a8080' }}
              maxLength={20}
            />
            <div className="flex-1 flex items-center justify-center">
              <div className="font-black text-white select-none"
                style={{ fontSize: 'clamp(5rem,16vw,9rem)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {team.score}
              </div>
            </div>
            <div className="shrink-0 flex flex-col gap-2">
              <ScoreButtons setTeam={setTeam} />
              <div className="flex justify-center">
                <FoulCounter team={team} setTeam={setTeam} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── ROW 3: Clock presets + Start/Reset ── */}
      <div className="shrink-0 flex items-center gap-3 flex-wrap rounded-2xl px-5 py-3"
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>
        <span className="text-xs uppercase tracking-widest shrink-0" style={{ color: '#4a2020' }}>Set Clock</span>
        <div className="flex gap-2 flex-wrap flex-1">
          {[[10, 0], [5, 0], [2, 0], [1, 0], [0, 30]].map(([m, s]) => (
            <button key={`${m}:${s}`}
              onClick={() => { setGameRun(false); setGameSecs(m * 60 + s) }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#9a8080' }}>
              {m}:{pad(s)}
            </button>
          ))}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setGameRun(r => !r)}
            className="px-7 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: orgColor }}>
            {gameRun ? '⏸ Pause' : '▶ Start'}
          </button>
          <button onClick={() => { setGameRun(false); setGameSecs(pDur) }}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}>
            Reset
          </button>
        </div>
      </div>

    </div>
  )
}

// ── Cheer / Stunt / Dance-Team competition scoreboard ────────────────────────
// The cheer-specific scoreboard surface. Wired in sportToScoreboard for
// programs with sport='cheerleading'; built for the June 18 supplier
// pitch demo.
//
// Three sections, top-to-bottom:
//   1. SQUAD NAME — editable inline input at the top. Defaults to the
//      org's program name; coaches can rename for a competition (e.g.
//      "Albertville Aggies Varsity").
//   2. ROUTINE TIMER — count-down from 2:30 (typical comp routine
//      length). Tap to edit MM:SS. Start/Pause + Reset transport plus
//      preset chips for 2:30 / 2:00 / 1:30 / 1:00. Big jumbotron-
//      readable type. Colour shifts amber under 30 s, red under 10 s.
//   3. SCORE — competitive cheer scores up to 200 with half-points
//      common. Four buttons: -1, -0.5, +0.5, +1. Displayed as an
//      integer when whole, one decimal when half. Tap the number to
//      reset to zero.
//
// No DB writes — purely client-side, so any role with access to the
// Scoreboard tab can operate this surface.
function CheerScoreboard({ orgColor, programName }) {
  const DEFAULT_SECS = 150  // 2:30

  const [squadName, setSquadName] = useState(programName ?? '')
  // Re-sync the squad name when the parent's programName changes (e.g.
  // AD switches programs while the Scoreboard tab is mounted).
  useEffect(() => { setSquadName(programName ?? '') }, [programName])

  const [secsLeft, setSecsLeft] = useState(DEFAULT_SECS)
  const [running,  setRunning]  = useState(false)
  const [presetSecs, setPresetSecs] = useState(DEFAULT_SECS)
  const [editingClock, setEditingClock] = useState(false)
  const [clockDraft,   setClockDraft]   = useState('')
  const [score, setScore] = useState(0)
  const intervalRef = useRef(null)

  // tick loop — same setInterval pattern as the football scoreboard
  useEffect(() => {
    if (!running) return
    intervalRef.current = setInterval(() => {
      setSecsLeft(prev => {
        if (prev <= 1) {
          // Reached 00:00 — stop the timer and hold at zero.
          setRunning(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [running])

  function commitClockEdit() {
    const parsed = parseTimeInput(clockDraft)
    if (typeof parsed === 'number' && parsed >= 0) {
      setSecsLeft(parsed)
      setPresetSecs(parsed)
    }
    setEditingClock(false)
    setClockDraft('')
  }

  // Clock colour: green > 30 s, amber > 10 s, red ≤ 10 s, white at 0.
  const clockColor =
    secsLeft === 0 ? '#ffffff'
    : secsLeft <= 10 ? '#ef4444'
    : secsLeft <= 30 ? '#f59e0b'
    :                  '#22c55e'

  // Adjust score by `delta` (positive or negative, may be a half).
  // Clamped to [0, 200] — the upper bound is generous (most comps top
  // out around 100 but the spec called for 0-200, leaving headroom for
  // sliding-scale judges or multi-routine totals).
  function adjustScore(delta) {
    setScore(s => {
      const next = Math.round((s + delta) * 2) / 2   // snap to halves
      if (next < 0)   return 0
      if (next > 200) return 200
      return next
    })
  }

  // Display the score as an integer when whole, otherwise one decimal.
  // `285` stays `285`; `285.5` shows `285.5`.
  const scoreDisplay = Number.isInteger(score) ? String(score) : score.toFixed(1)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-7 p-6 overflow-y-auto">
      {/* Editable squad name — tap the text to rename inline. Matches
          the editable-input pattern from FootballScoreboard's TeamLabel
          (transparent background, bottom border on focus). */}
      <input
        value={squadName}
        onChange={e => setSquadName(e.target.value)}
        placeholder="Squad Name"
        maxLength={48}
        className="bg-transparent outline-none text-center font-black"
        style={{
          fontSize:      'clamp(1rem, 3.2vw, 1.6rem)',
          color:         '#ffffff',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          maxWidth:      '90%',
          width:         '90%',
          borderBottom:  `2px solid ${orgColor}44`,
          paddingBottom: '0.25rem',
        }}
      />

      <p className="text-sm font-bold tracking-widest uppercase" style={{ color: '#9a8080', letterSpacing: '0.2em' }}>
        Routine Timer
      </p>

      {/* Big clock — tappable to edit (matches the football scoreboard's
          parseTimeInput / MM:SS-edit pattern) */}
      {editingClock ? (
        <input
          autoFocus
          value={clockDraft}
          onChange={e => setClockDraft(e.target.value)}
          onBlur={commitClockEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitClockEdit() }}
          placeholder="2:30"
          className="font-mono font-black text-center bg-transparent outline-none"
          style={{
            fontSize:           'clamp(5rem, 18vw, 11rem)',
            color:              clockColor,
            border:             `2px solid ${orgColor}55`,
            borderRadius:       24,
            padding:            '0 1rem',
            minWidth:           '6ch',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
      ) : (
        <button
          onClick={() => { setClockDraft(fmtClock(secsLeft)); setEditingClock(true); setRunning(false) }}
          className="font-mono font-black leading-none select-none"
          style={{
            fontSize:           'clamp(5rem, 18vw, 11rem)',
            color:              clockColor,
            textShadow:         `0 0 80px ${clockColor}66`,
            transition:         'color 0.6s, text-shadow 0.6s',
            fontVariantNumeric: 'tabular-nums',
            background:         'transparent',
            border:             'none',
            cursor:             'pointer',
          }}
        >
          {fmtClock(secsLeft)}
        </button>
      )}

      {/* Transport: Start/Pause, Reset, preset times. */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <button
          onClick={() => setRunning(r => !r)}
          disabled={secsLeft === 0 && !running}
          className="h-12 px-7 rounded-xl font-black text-white transition-all disabled:opacity-30"
          style={{ backgroundColor: orgColor, minWidth: 130, fontSize: '1.05rem' }}
        >
          {running ? '⏸ Pause' : '▶ Start'}
        </button>
        <button
          onClick={() => { setRunning(false); setSecsLeft(presetSecs) }}
          className="h-12 px-4 rounded-xl font-bold text-sm"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000', color: '#9a8080' }}
        >
          ↺ Reset
        </button>
        {[
          { label: '2:30', secs: 150 },
          { label: '2:00', secs: 120 },
          { label: '1:30', secs: 90  },
          { label: '1:00', secs: 60  },
        ].map(p => {
          const isActive = presetSecs === p.secs
          return (
            <button
              key={p.label}
              onClick={() => { setRunning(false); setSecsLeft(p.secs); setPresetSecs(p.secs) }}
              className="h-12 px-3 rounded-lg text-xs font-bold"
              style={{
                backgroundColor: isActive ? `${orgColor}22` : '#110000',
                border:          `1px solid ${isActive ? orgColor : '#2a0000'}`,
                color:           isActive ? orgColor : '#9a8080',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Score — optional but featured in the demo. Four adjustment
          buttons (-1, -0.5, +0.5, +1) bracket the big score readout.
          Tap the number itself to reset to zero. Cap at 200; the spec
          asked for 0-200 to leave headroom for cumulative totals. */}
      <div className="flex flex-col items-center gap-2 mt-2">
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: '#6a4040', letterSpacing: '0.2em' }}>
          Score
        </p>
        <div className="flex items-center gap-2">
          {/* -1 then -0.5 on the left side */}
          <button
            onClick={() => adjustScore(-1)}
            className="w-14 h-12 rounded-xl font-black text-base"
            style={{ backgroundColor: '#110000', border: '1px solid #2a0000', color: '#9a8080' }}
          >
            −1
          </button>
          <button
            onClick={() => adjustScore(-0.5)}
            className="w-14 h-12 rounded-xl font-black text-sm"
            style={{ backgroundColor: '#110000', border: '1px solid #2a0000', color: '#9a8080' }}
          >
            −½
          </button>

          {/* The score itself — large, tabular nums for stable width
              between integer and one-decimal renderings. */}
          <button
            onClick={() => setScore(0)}
            title="Tap to reset"
            className="font-mono font-black px-2"
            style={{
              fontSize:           'clamp(2.4rem, 7vw, 3.8rem)',
              color:              '#ffffff',
              minWidth:           '5ch',
              textAlign:          'center',
              background:         'transparent',
              border:             'none',
              cursor:             'pointer',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {scoreDisplay}
          </button>

          {/* +0.5 then +1 on the right side, +1 in orgColor to mirror
              the Start button. */}
          <button
            onClick={() => adjustScore(0.5)}
            className="w-14 h-12 rounded-xl font-black text-sm text-white"
            style={{ backgroundColor: `${orgColor}99`, border: `1px solid ${orgColor}` }}
          >
            +½
          </button>
          <button
            onClick={() => adjustScore(1)}
            className="w-14 h-12 rounded-xl font-black text-base text-white"
            style={{ backgroundColor: orgColor }}
          >
            +1
          </button>
        </div>
      </div>
    </div>
  )
}

// Stepper for a single Tabata setting — 44px tap targets (iPad HIG
// minimum), matching the football scoreboard's Ball On / Yards-to-Go
// +/- polish. Declared at module scope (not inside TabataScoreboard) so
// it isn't recreated every render.
function Stepper({ label, value, suffix = '', canConfigure, disabled, onDecrement, onIncrement }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs uppercase tracking-widest" style={{ color: '#9a8080' }}>{label}</span>
      {canConfigure ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onDecrement}
            disabled={disabled}
            className="w-11 h-11 rounded-lg text-lg font-bold flex items-center justify-center disabled:opacity-30"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}
          >
            −
          </button>
          <span className="font-mono font-black text-white text-center" style={{ minWidth: '4ch', fontVariantNumeric: 'tabular-nums' }}>
            {value}{suffix}
          </span>
          <button
            onClick={onIncrement}
            disabled={disabled}
            className="w-11 h-11 rounded-lg text-lg font-bold flex items-center justify-center disabled:opacity-30"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}
          >
            +
          </button>
        </div>
      ) : (
        // team_manager (and any other non-admin role): read-only value,
        // no steppers — they can run the timer but not reconfigure it.
        <span className="font-mono font-black text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}{suffix}
        </span>
      )}
    </div>
  )
}

// ── TabataScoreboard ─────────────────────────────────────────────────────────
// Weight Training's scoreboard surface: a configurable work/rest interval
// timer (standard Tabata defaults — 20s work / 10s rest / 8 rounds).
//
// Operate vs configure: matches the canAdminister gate used elsewhere in
// the app (Program Logo, Practice Screen Background, etc.) — every role
// that can reach the Scoreboard tab can Start/Pause/Reset, but only
// head_coach/ad can edit the work/rest/round settings. currentRole comes
// from useOrg() (Commit C) since this is org-scoped content, same as
// Whiteboard/Scripts/Audio's canEdit checks.
//
// Audio: reuses the existing lib/sounds.js engine rather than building a
// new one — playWhistle() (short, non-fatiguing) marks every work↔rest
// transition since those repeat many times a session; playAirHorn()
// (the practice timer's existing "big, this segment is over" cue) marks
// the workout finishing. Sounds fire from a useEffect watching the
// derived phase/completed state, not from inside the tick's setState
// updater — updaters can double-invoke under StrictMode, effects don't.
//
// No DB writes — same as every other scoreboard surface, purely local
// React state reset on tab reload.
function TabataScoreboard({ orgColor, programName }) {
  const { currentRole } = useOrg()
  const canConfigure = canAdminister(currentRole)

  // ── Interval settings (editable pre-start by head_coach/ad only) ──────────
  const [workSecs, setWorkSecs]         = useState(20)
  const [restSecs, setRestSecs]         = useState(10)
  const [totalRounds, setTotalRounds]   = useState(8)

  // ── Active session state ───────────────────────────────────────────────────
  const [timer, setTimer] = useState({
    started: false, running: false, completed: false,
    phase: 'work', round: 1, secsLeft: 20,
  })

  function handleReset() {
    setTimer({ started: false, running: false, completed: false, phase: 'work', round: 1, secsLeft: workSecs })
  }

  // Keep the pre-start clock seeded from the Work setting. secsLeft is only
  // otherwise re-seeded on reset/restart, so bumping Work from 20s to 30s
  // before starting left the display — and the first work interval — on the
  // stale 20s. Guarded on `started` so it can never stomp a live countdown,
  // and returns `prev` unchanged when already in sync so it can't loop.
  useEffect(() => {
    if (timer.started) return
    setTimer(prev => (prev.secsLeft === workSecs ? prev : { ...prev, secsLeft: workSecs }))
  }, [workSecs, timer.started])

  function handleStartPause() {
    if (timer.completed) {
      setTimer({ started: true, running: true, completed: false, phase: 'work', round: 1, secsLeft: workSecs })
      return
    }
    setTimer(prev => ({ ...prev, started: true, running: !prev.running }))
  }

  // Tick loop — same setInterval pattern as every other scoreboard clock
  // in this file. Reads workSecs/restSecs/totalRounds from the effect's
  // closure (settings are locked once started, so they're stable for the
  // life of a run — see the `disabled={timer.started}` on the steppers
  // below).
  useEffect(() => {
    if (!timer.running) return
    const id = setInterval(() => {
      setTimer(prev => {
        if (prev.secsLeft > 1) return { ...prev, secsLeft: prev.secsLeft - 1 }
        if (prev.phase === 'work' && prev.round >= totalRounds) {
          return { ...prev, secsLeft: 0, running: false, completed: true }
        }
        if (prev.phase === 'work') {
          return { ...prev, phase: 'rest', secsLeft: restSecs }
        }
        return { ...prev, phase: 'work', round: prev.round + 1, secsLeft: workSecs }
      })
    }, 1000)
    return () => clearInterval(id)
  }, [timer.running, workSecs, restSecs, totalRounds])

  // Audio cues — fire once per actual phase/completion change.
  const prevPhaseRef     = useRef(timer.phase)
  const prevCompletedRef = useRef(timer.completed)
  useEffect(() => {
    if (timer.completed && !prevCompletedRef.current) {
      playAirHorn()
    } else if (timer.started && timer.phase !== prevPhaseRef.current) {
      playWhistle()
    }
    prevPhaseRef.current     = timer.phase
    prevCompletedRef.current = timer.completed
  }, [timer.phase, timer.completed, timer.started])

  function adjustSetting(setter, value, delta, min, max) {
    if (timer.started) return
    setter(Math.max(min, Math.min(max, value + delta)))
  }

  const isWork    = timer.phase === 'work'
  const phaseColor = timer.completed ? '#22c55e' : isWork ? orgColor : '#2563eb'
  const phaseLabel = timer.completed ? 'DONE' : isWork ? 'WORK' : 'REST'

  const startLabel = timer.completed ? 'Restart' : timer.running ? 'Pause' : timer.started ? 'Resume' : 'Start'

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-6 items-center">
      {programName && (
        <div className="text-center">
          <h2 className="text-lg font-black text-white tracking-wide">{programName}</h2>
          <p className="text-xs uppercase tracking-widest" style={{ color: '#9a8080' }}>Weight Training</p>
        </div>
      )}

      <div className="text-sm font-bold uppercase tracking-widest" style={{ color: '#9a8080' }}>
        Round {timer.round} of {totalRounds}
      </div>

      {/* WORK/REST state — big color-coded block so it reads at a glance
          from across the weight room. */}
      <div
        className="w-full max-w-md rounded-3xl flex flex-col items-center gap-2 py-8 transition-colors"
        style={{ backgroundColor: `${phaseColor}22`, border: `3px solid ${phaseColor}` }}
      >
        <span className="text-2xl font-black tracking-[0.2em]" style={{ color: phaseColor }}>
          {phaseLabel}
        </span>
        <span
          className="font-mono font-black leading-none"
          style={{ fontSize: 'clamp(3.5rem, 16vw, 8rem)', color: '#fff', fontVariantNumeric: 'tabular-nums' }}
        >
          {fmtClock(timer.secsLeft)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleStartPause}
          className="px-6 py-3 rounded-xl font-bold text-white"
          style={{ backgroundColor: timer.running ? '#7a2020' : orgColor, minHeight: 44 }}
        >
          {startLabel}
        </button>
        <button
          onClick={handleReset}
          className="px-6 py-3 rounded-xl font-bold"
          style={{ border: '1px solid #2a0000', color: '#9a8080', minHeight: 44 }}
        >
          Reset
        </button>
      </div>

      {/* Interval settings. Steppers only interactive for head_coach/ad
          (canConfigure); team_manager sees the same values read-only.
          Locked for everyone once a session has started — reset first. */}
      <div className="w-full max-w-md rounded-2xl p-4 flex items-center justify-around"
        style={{ backgroundColor: '#0d0000', border: '1px solid #2a0000' }}>
        <Stepper
          label="Work" value={workSecs} suffix="s" canConfigure={canConfigure} disabled={timer.started}
          onDecrement={() => adjustSetting(setWorkSecs, workSecs, -5, 5, 300)}
          onIncrement={() => adjustSetting(setWorkSecs, workSecs, 5, 5, 300)}
        />
        <Stepper
          label="Rest" value={restSecs} suffix="s" canConfigure={canConfigure} disabled={timer.started}
          onDecrement={() => adjustSetting(setRestSecs, restSecs, -5, 0, 300)}
          onIncrement={() => adjustSetting(setRestSecs, restSecs, 5, 0, 300)}
        />
        <Stepper
          label="Rounds" value={totalRounds} canConfigure={canConfigure} disabled={timer.started}
          onDecrement={() => adjustSetting(setTotalRounds, totalRounds, -1, 1, 30)}
          onIncrement={() => adjustSetting(setTotalRounds, totalRounds, 1, 1, 30)}
        />
      </div>
      {!canConfigure && (
        <p className="text-xs text-center" style={{ color: '#6a4040' }}>
          Only a Head Coach or Athletic Director can change these settings.
        </p>
      )}
    </div>
  )
}

// ── GenericScoreboard ────────────────────────────────────────────────────────
// Minimal home/away score + game clock + period indicator. The fallback
// surface for every launch-list sport that doesn't have a purpose-built
// scoreboard (Flag Football, Soccer M/F, Volleyball, Baseball, Softball,
// Cheerleading, Custom). Football and Boys/Girls Basketball still get
// their sport-specific scoreboards.
//
// No DB writes — all state is local React. Operate-only roles
// (team_manager) can run this entirely client-side; the sport-config
// gates ad+head_coach (set in Program Settings, not here).
function GenericScoreboard({ orgColor, homeTeamName, awayTeamName, programName, sportDisplayLabel }) {
  const [home, setHome] = useState({ name: homeTeamName || 'HOME', score: 0 })
  const [away, setAway] = useState({ name: awayTeamName || 'AWAY', score: 0 })
  const [period, setPeriod] = useState(1)
  // Default to 12:00 — middling between basketball halves (20:00),
  // soccer halves (45:00), and volleyball sets (no clock). Coaches can
  // tap to retype anything.
  const [gameSecs, setGameSecs] = useState(12 * 60)
  const [gameRun,  setGameRun]  = useState(false)

  useEffect(() => {
    if (!gameRun) return
    const id = setInterval(
      () => setGameSecs(s => { if (s <= 0) { setGameRun(false); return 0 } return s - 1 }),
      1000,
    )
    return () => clearInterval(id)
  }, [gameRun])

  function adj(setTeam, pts) {
    setTeam(t => ({ ...t, score: Math.max(0, t.score + pts) }))
  }

  const ScoreBtns = ({ setTeam }) => (
    <div className="flex gap-2 w-full">
      {[1, 2, 3].map(pts => (
        <button
          key={pts}
          onClick={() => adj(setTeam, pts)}
          className="flex-1 rounded-xl font-black py-3"
          style={{
            backgroundColor: `${orgColor}22`,
            border:          `2px solid ${orgColor}`,
            color:            orgColor,
            fontSize:         '1.4rem',
          }}
        >
          +{pts}
        </button>
      ))}
      <button
        onClick={() => adj(setTeam, -1)}
        className="rounded-xl font-bold px-3"
        style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#6a4040', fontSize: '0.85rem' }}
      >
        −1
      </button>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-5">
      {programName && (
        <div className="text-center">
          <h2 className="text-lg font-black text-white tracking-wide">{programName}</h2>
          {sportDisplayLabel && (
            <p className="text-xs uppercase tracking-widest" style={{ color: '#9a8080' }}>
              {sportDisplayLabel}
            </p>
          )}
        </div>
      )}

      {/* Clock + period */}
      <div className="flex flex-col items-center gap-3">
        <GameClock
          secs={gameSecs}
          warn={gameSecs <= 60 && gameSecs > 0}
          running={gameRun}
          onChange={v => setGameSecs(v)}
        />
        <button
          onClick={() => setGameRun(r => !r)}
          className="px-5 py-2.5 rounded-xl font-bold text-white"
          style={{ backgroundColor: gameRun ? '#7a2020' : orgColor }}
        >
          {gameRun ? 'Pause' : 'Start'}
        </button>

        <div className="flex items-center gap-3">
          <button onClick={() => setPeriod(p => Math.max(1, p - 1))}
            className="w-9 h-9 rounded-lg text-base font-bold"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}>−</button>
          <span className="font-bold text-white" style={{ minWidth: 90, textAlign: 'center' }}>
            Period {period}
          </span>
          <button onClick={() => setPeriod(p => Math.min(9, p + 1))}
            className="w-9 h-9 rounded-lg text-base font-bold"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}>+</button>
        </div>
      </div>

      {/* Home / Away */}
      {[
        { side: 'home', team: home, setTeam: setHome },
        { side: 'away', team: away, setTeam: setAway },
      ].map(({ side, team, setTeam }) => (
        <div key={side}
          className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ backgroundColor: '#0d0000', border: '1px solid #2a0000' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest" style={{ color: '#9a8080' }}>
              {side === 'home' ? 'Home' : 'Away'}
            </span>
            <input
              value={team.name}
              onChange={e => setTeam(t => ({ ...t, name: e.target.value }))}
              className="bg-transparent text-right font-black text-white text-base outline-none"
              style={{ maxWidth: '60%' }}
              maxLength={24}
            />
          </div>
          <div className="font-black text-center"
            style={{ color: orgColor, fontSize: 'clamp(3rem, 12vw, 7rem)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {team.score}
          </div>
          <ScoreBtns setTeam={setTeam} />
        </div>
      ))}
    </div>
  )
}

// ── Root: pick scoreboard surface by org sport ───────────────────────────────
// No more sport picker. The program's sport (set in Program Settings) is
// the single source of truth — Scoreboard auto-renders the surface that
// fits. Changing sports happens in Program Settings, not here. This
// matches the rest of the app (Scripts/Music/Whiteboard already scope
// to the program; Scoreboard now does the same).
//
// Mapping:
//   football                                   → FootballScoreboard
//   boys_basketball, girls_basketball,         → BasketballScoreboard
//     basketball (legacy)
//   cheerleading, plus legacy stunt / dance /  → CheerScoreboard
//     dance team
//   weight_training                            → TabataScoreboard
//   anything else (flag_football, boys_soccer, → GenericScoreboard
//     girls_soccer, volleyball, baseball,
//     softball, custom, null/undefined)
function sportToScoreboard(orgSport) {
  const s = typeof orgSport === 'string' ? orgSport.toLowerCase() : ''
  if (s === 'football')                                   return 'football'
  if (s === 'boys_basketball'
   || s === 'girls_basketball'
   || s === 'basketball')                                 return 'basketball'
  if (s === 'cheerleading'
   || s === 'stunt'
   || s === 'dance'
   || s === 'dance team')                                 return 'cheer'
  if (s === 'weight_training')                             return 'tabata'
  return 'generic'
}

export default function ScoreboardSection({
  orgColor, accountId, homeTeamName, awayTeamName, programName,
  sport: orgSport, sportCustomLabel,
}) {
  const surface = sportToScoreboard(orgSport)

  // Display label for the generic scoreboard header. Falls back to the
  // raw sport value if it's not in the launch list — kept best-effort
  // readable in roleLabel style. For sport='custom', sportCustomLabel is
  // the authoritative display string.
  let sportDisplayLabel = ''
  if (orgSport === 'custom' && sportCustomLabel) {
    sportDisplayLabel = sportCustomLabel
  } else if (typeof orgSport === 'string' && orgSport.length > 0) {
    sportDisplayLabel = orgSport
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }

  // Pick the right sub-scoreboard for the program's sport. Each one
  // already returns a `flex-1 flex flex-col ...` root, so they render
  // cleanly inside the shared wrapper below.
  let surfaceEl
  if (surface === 'football') {
    surfaceEl = (
      <FootballScoreboard
        orgColor={orgColor}
        accountId={accountId}
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        programName={programName}
      />
    )
  } else if (surface === 'basketball') {
    surfaceEl = <BasketballScoreboard orgColor={orgColor} />
  } else if (surface === 'cheer') {
    surfaceEl = <CheerScoreboard orgColor={orgColor} programName={programName} />
  } else if (surface === 'tabata') {
    surfaceEl = <TabataScoreboard orgColor={orgColor} programName={programName} />
  } else {
    surfaceEl = (
      <GenericScoreboard
        orgColor={orgColor}
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
        programName={programName}
        sportDisplayLabel={sportDisplayLabel}
      />
    )
  }

  // Shared wrapper for every scoreboard surface: a small `shrink-0`
  // header bar at the top-right that hosts the StadiumNoiseToggle,
  // then the chosen sub-scoreboard taking the rest of the vertical
  // space. The header is the same shape across all four scoreboards
  // (Football, Basketball, Cheer, Tabata, Generic) so the crowd-noise button
  // lives in a predictable spot regardless of which surface is
  // rendered — and it never collides with sport-specific top-right
  // content (e.g. Basketball's Period Controls box). Audio state
  // lives in the stadiumNoise singleton, so toggling here mirrors
  // toggling from the Practice tab and vice-versa.
  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div className="shrink-0 flex justify-end items-start px-3 py-2">
        <StadiumNoiseToggle orgColor={orgColor} />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {surfaceEl}
      </div>
    </div>
  )
}
