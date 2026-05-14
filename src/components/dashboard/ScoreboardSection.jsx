import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { COMPETITION_SPORTS } from '../../lib/sports'
import { useAuth } from '../../context/AuthContext'
import { canEdit } from '../../lib/permissions'

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
          fontSize: 'clamp(3rem, 11.5vw, 9rem)',
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
        fontSize:           'clamp(3rem, 11.5vw, 9rem)',
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
        <div className="flex-1 flex flex-col rounded-2xl overflow-hidden"
          style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>

          {/* ROW 1: DOWN — tap digit to cycle 1 → 2 → 3 → 4 → 1 */}
          <div className="flex-1 flex items-center px-5 relative"
            style={{ borderBottom: '1px solid #2a0000' }}>
            <button
              onClick={() => setDown(d => (d + 1) % 4)}
              style={{
                fontFamily:         '"Courier New", "Roboto Mono", monospace',
                fontSize:           'clamp(5rem, 10vw, 7rem)',
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
                fontSize:           'clamp(5rem, 10vw, 7rem)',
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
            {/* Small −/+ tucked in bottom-right corner */}
            <div className="absolute bottom-2 right-3 flex gap-1">
              <button
                onClick={() => setDistance(d => Math.max(1, d - 1))}
                className="flex items-center justify-center rounded-lg font-bold"
                style={{ width: 44, height: 44, border: '1px solid #2a0000', color: '#5a3030', fontSize: '1.1rem' }}
              >−</button>
              <button
                onClick={() => setDistance(d => Math.min(99, d + 1))}
                className="flex items-center justify-center rounded-lg font-bold"
                style={{ width: 44, height: 44, border: '1px solid #2a0000', color: '#5a3030', fontSize: '1.1rem' }}
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
                  fontSize:           'clamp(5rem, 10vw, 7rem)',
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
                  fontSize:           'clamp(5rem, 10vw, 7rem)',
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
            {/* Small −/+ tucked in bottom-right corner */}
            <div className="absolute bottom-2 right-3 flex gap-1">
              <button
                onClick={() => setBallOn(b => Math.max(1, b - 1))}
                className="flex items-center justify-center rounded-lg font-bold"
                style={{ width: 44, height: 44, border: '1px solid #2a0000', color: '#5a3030', fontSize: '1.1rem' }}
              >−</button>
              <button
                onClick={() => setBallOn(b => Math.min(99, b + 1))}
                className="flex items-center justify-center rounded-lg font-bold"
                style={{ width: 44, height: 44, border: '1px solid #2a0000', color: '#5a3030', fontSize: '1.1rem' }}
              >+</button>
            </div>
          </div>
        </div>

        {/* ── CENTER: Game clock + controls ────────────────────────────────── */}
        <div className="flex-[1.4] flex flex-col gap-2 rounded-2xl px-4 py-4"
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

          {/* Game clock — flex-1 centered */}
          <div className="flex-1 flex flex-col items-center justify-center gap-1">
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
        <div
          className="flex-1 flex flex-col items-center gap-3 rounded-2xl px-4 py-4"
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

          {/* Big amber number */}
          <div className="flex-1 flex items-center justify-center">
            <span
              className="font-black font-mono leading-none"
              style={{
                fontSize:           'clamp(7rem, 16vw, 11rem)',
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
// Minimal count-down routine timer + optional score field. Built for the
// cheerleading-supplier demo — coaches running cheer / stunt / dance-team
// programs land here automatically (auto-selected by org.sport in the
// root component below). Football and Basketball coaches can still pick
// this surface manually from the picker if they want a generic
// competition timer.
//
// Default time = 2:30 (typical cheer routine length). Coach can tap the
// big clock to set any duration in MM:SS format. Score field starts at
// 0 with simple +/− buttons; coach can ignore it if their routine
// doesn't track points.
function CheerScoreboard({ orgColor, programName }) {
  const DEFAULT_SECS = 150  // 2:30

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

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 p-6 overflow-y-auto">
      {programName && (
        <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#6a4040' }}>
          {programName}
        </p>
      )}

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

      {/* Optional score — coach can ignore it. +/− buttons + tap the
          number to reset to zero. Compact, sits below transport. */}
      <div className="flex flex-col items-center gap-2 mt-2">
        <p className="text-xs font-bold tracking-widest uppercase" style={{ color: '#6a4040', letterSpacing: '0.2em' }}>
          Score (optional)
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setScore(s => Math.max(0, s - 1))}
            className="w-12 h-12 rounded-xl font-black text-xl"
            style={{ backgroundColor: '#110000', border: '1px solid #2a0000', color: '#9a8080' }}
          >
            −
          </button>
          <button
            onClick={() => setScore(0)}
            title="Tap to reset"
            className="font-mono font-black"
            style={{
              fontSize: 'clamp(2.2rem, 6vw, 3.4rem)',
              color:    '#ffffff',
              minWidth: '3ch',
              textAlign:'center',
              background: 'transparent',
              border:     'none',
              cursor:     'pointer',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {score}
          </button>
          <button
            onClick={() => setScore(s => s + 1)}
            className="w-12 h-12 rounded-xl font-black text-xl text-white"
            style={{ backgroundColor: orgColor }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sport picker + root ───────────────────────────────────────────────────────

export default function ScoreboardSection({ orgColor, accountId, homeTeamName, awayTeamName, programName, sport: orgSport }) {
  // The Football and Basketball scoreboards mix "configure" (set
  // quarters/period length, edit team names) and "operate" (advance
  // clock, +/- score) in the same controls. The user spec asked for
  // readonly to be able to OPERATE during games but not CONFIGURE —
  // since the two aren't cleanly separable today, gate ALL scoreboard
  // edits for readonly. Show a one-line "read-only — ask a coach to
  // run the scoreboard" message instead of the picker so the surface
  // doesn't look broken.
  const { profile } = useAuth()
  const userCanEdit = canEdit(profile?.role)
  if (!userCanEdit) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <span style={{ fontSize: 48, opacity: 0.25 }}>🏆</span>
        <p className="font-bold text-white text-base">Scoreboard is read-only</p>
        <p className="text-sm max-w-md" style={{ color: '#9a8080' }}>
          Your account role is set to read-only. Ask a coach, admin, or owner
          on your staff to run the scoreboard during games.
        </p>
      </div>
    )
  }
  // Auto-select the cheer/competition scoreboard for cheer / stunt /
  // dance-team programs. The picker is still reachable via the "← Change"
  // button at the top of the sub-scoreboard, so a cheer coach who wants
  // a football scoreboard for a game-day matchup can still pick it.
  const competitionDefault =
    typeof orgSport === 'string' && COMPETITION_SPORTS.has(orgSport.toLowerCase())
  const [sport, setSport] = useState(competitionDefault ? 'cheer' : null)

  // Picker options. Cheer/Competition is shown to ALL programs so a
  // football coach who wants a generic count-down timer can pick it too.
  const PICKER = [
    { id: 'football',   label: 'Football',   emoji: '🏈' },
    { id: 'basketball', label: 'Basketball', emoji: '🏀' },
    { id: 'cheer',      label: 'Competition', emoji: '📣' },
  ]

  if (!sport) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        <h2 className="text-xl font-black text-white tracking-wide">Choose Sport</h2>
        <div className="flex gap-6 flex-wrap justify-center">
          {PICKER.map(s => (
            <button
              key={s.id}
              onClick={() => setSport(s.id)}
              className="flex flex-col items-center gap-4 rounded-2xl transition-all"
              style={{ backgroundColor: '#1a0000', border: '2px solid #2a0000', padding: '2.5rem 3rem', minWidth: 180 }}
            >
              <span style={{ fontSize: 64 }}>{s.emoji}</span>
              <span className="font-black text-white text-lg">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const activeLabel = PICKER.find(p => p.id === sport)?.label ?? sport
  const activeEmoji = PICKER.find(p => p.id === sport)?.emoji ?? ''

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div className="flex items-center gap-3 px-4 pt-3 shrink-0">
        <button
          onClick={() => setSport(null)}
          className="text-sm font-semibold px-4 py-2 rounded-xl"
          style={{ border: '1px solid #2a0000', color: '#9a8080' }}
        >
          ← Change
        </button>
        <span className="font-black text-white text-base">
          {activeEmoji} {activeLabel}
        </span>
      </div>
      {sport === 'football' && (
        <FootballScoreboard
          orgColor={orgColor}
          accountId={accountId}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
          programName={programName}
        />
      )}
      {sport === 'basketball' && (
        <BasketballScoreboard orgColor={orgColor} />
      )}
      {sport === 'cheer' && (
        <CheerScoreboard orgColor={orgColor} programName={programName} />
      )}
    </div>
  )
}
