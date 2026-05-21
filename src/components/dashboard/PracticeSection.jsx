import { useState, useEffect, useRef } from 'react'
import {
  subscribe, getSnapshot,
  startPause, reset, jumpTo, next,
  setTimeTo, addMinute, subtractMinute,
  setActiveScript,
  setAutoAdvance, setAllowOverrun, setHornOnEnd, setBellAt30, setStopMusicOnEnd,
} from '../../lib/practiceTimer'
import {
  subscribe as subscribeAudio,
  getSnapshot as getAudioSnapshot,
  togglePlay as audioTogglePlay,
  playNext as audioPlayNext,
  playPrev as audioPlayPrev,
  pause as audioPause,
  resume as audioResume,
} from '../../lib/audioPlayer'
import {
  playCue,
  stopCue,
  isCuePlaying,
} from '../../lib/cuePlayer'
import {
  subscribe as subscribeStadium,
  getSnapshot as getStadiumSnapshot,
  toggle as toggleStadium,
} from '../../lib/stadiumNoise'

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

// ── Music mini controls (left side of slide-up controls panel) ──────────────
// Compact prev / play-pause / next quick-reach controls. Wires straight into
// the existing audioPlayer singleton — no new audio logic. The standalone
// "Now Playing" docked bar at the bottom of the screen was removed when the
// song-name display was integrated here — the slide-up panel is now the
// single surface for music transport AND current-song info.
const MusicPlayIcon  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
const MusicPauseIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
const MusicSkipBack  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
const MusicSkipFwd   = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>

function MusicMiniControls({ orgColor }) {
  const [snap, setSnap] = useState(() => getAudioSnapshot())
  useEffect(() => {
    return subscribeAudio((type, payload) => {
      if (type === 'state') setSnap({ ...payload })
    })
  }, [])

  const hasPlaylist = (snap.playlist?.length ?? 0) > 0
  const isPlaying   = !!snap.isPlaying
  const songName    = snap.song?.name ?? ''

  const btnStyle = (disabled) => ({
    backgroundColor: '#0d0800',
    border:          `1px solid ${orgColor}33`,
    color:           disabled ? '#3a2a1a' : '#e8d8c8',
    opacity:         disabled ? 0.45 : 1,
    cursor:          disabled ? 'not-allowed' : 'pointer',
  })

  return (
    <div
      // Left side of the slide-up controls panel.
      className="shrink-0 self-start mt-1 flex items-center gap-2 rounded-2xl px-2 py-2"
      style={{
        backgroundColor: 'rgba(13,8,0,0.85)',
        border:          `1px solid ${orgColor}22`,
        backdropFilter:  'blur(6px)',
      }}
    >
      <button
        onClick={() => audioPlayPrev().catch(() => {})}
        disabled={!hasPlaylist}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95"
        style={btnStyle(!hasPlaylist)}
        aria-label="Previous song"
      >
        <MusicSkipBack />
      </button>
      <button
        onClick={() => audioTogglePlay().catch(() => {})}
        disabled={!hasPlaylist}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95"
        style={{
          ...btnStyle(!hasPlaylist),
          backgroundColor: hasPlaylist ? orgColor : '#0d0800',
          color:           hasPlaylist ? '#fff' : '#3a2a1a',
          border:          hasPlaylist ? `1px solid ${orgColor}` : `1px solid ${orgColor}33`,
        }}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying
          ? <MusicPauseIcon />
          : <span style={{ marginLeft: 2 }}><MusicPlayIcon /></span>}
      </button>
      <button
        onClick={() => audioPlayNext().catch(() => {})}
        disabled={!hasPlaylist}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95"
        style={btnStyle(!hasPlaylist)}
        aria-label="Next song"
      >
        <MusicSkipFwd />
      </button>

      {/* Current-song name — replaces the standalone "Now Playing" docked
          bar that used to live at the bottom of every tab. Inline with the
          transport buttons, no "Now Playing" label (context is obvious).
          Truncates with ellipsis on long titles; capped max-width so a
          7-minute psyche-up mix doesn't push the rest of the toolbar
          off-screen on narrower iPads. */}
      {hasPlaylist && songName && (
        <span
          className="text-xs font-semibold truncate pl-1 pr-2"
          style={{
            color:    '#e8d8c8',
            maxWidth: 160,
            // Slight letter-spacing tightening so it visually balances
            // the chunky transport buttons next to it.
            letterSpacing: '0.01em',
          }}
          title={songName}
        >
          {songName}
        </span>
      )}
    </div>
  )
}

// ── Stadium noise toggle (bottom-right of practice tab) ──────────────────────
// Standalone widget. Wires to the stadiumNoise singleton — does NOT participate
// in horn/voice ducking or the music player. Looped playback at full volume;
// tap to start, tap again to stop. Uses the lucide Megaphone glyph (rendered as
// inline SVG, same convention as the rest of this app's icons) so the affordance
// reads unambiguously as "crowd noise" rather than "mute". Permanent CROWD label
// underneath so coaches always know what the button does.
const MegaphoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
)

function StadiumNoiseToggle({ orgColor }) {
  const [snap, setSnap] = useState(() => getStadiumSnapshot())
  useEffect(() => subscribeStadium(setSnap), [])
  const isOn = !!snap.isPlaying

  return (
    <div className="shrink-0 flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => toggleStadium().catch(() => {})}
        aria-label={isOn ? 'Stop stadium noise' : 'Play stadium noise'}
        // 44x44 touch-target. Visual emphasis flips with state: filled in
        // orgColor + glow when ON, dim outline when OFF.
        className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all active:scale-95"
        style={{
          backgroundColor: isOn ? orgColor : 'transparent',
          border:          `1px solid ${isOn ? orgColor : `${orgColor}55`}`,
          color:           isOn ? '#ffffff' : '#9a8080',
          boxShadow:       isOn ? `0 0 12px ${orgColor}66` : 'none',
        }}
      >
        <MegaphoneIcon />
      </button>
      <span
        className="font-semibold transition-colors"
        style={{
          fontSize:      11,
          letterSpacing: '0.12em',
          color:         isOn ? orgColor : '#7a6060',
        }}
      >
        CROWD
      </span>
    </div>
  )
}

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
export default function PracticeSection({ activeScript, orgColor, backgroundUrl, backgroundDim = 0 }) {

  // Subscribe to the singleton — re-render on every tick
  const [snap, setSnap] = useState(() => getSnapshot())
  useEffect(() => subscribe(setSnap), [])

  // Tell the singleton when the script prop changes (only resets if script changed)
  useEffect(() => {
    setActiveScript(activeScript)
  }, [activeScript])

  // Derive display values from snapshot — declared HERE (before the cue
  // orchestration useEffects below) because those effects' dependency
  // arrays read `hasStarted`, `currentDrillIdx`, and `drills`. Dep arrays
  // are evaluated synchronously during render, so the names they reference
  // must already be initialized — otherwise we hit a temporal-dead-zone
  // ReferenceError ("Cannot access 'X' before initialization") in
  // production minified builds where variable names are mangled.
  const {
    isRunning, hasStarted,
    secondsLeft, totalSeconds,
    currentDrillIdx,
    isOverrun, overrunSeconds,
    autoAdvance, allowOverrun, hornOnEnd, bellAt30, stopMusicOnEnd,
  } = snap
  // Normalize drill shape defensively: legacy seeded scripts (and any drill
  // that pre-dates the per-drill notes / cue features) may only carry
  // { name, duration }. Spread defaults FIRST then the raw drill so any
  // explicit value wins. Guarantees `notes`, `show_notes`, and
  // `cue_mp3_url` are always present at the read site, regardless of
  // origin.
  const drills = (snap.activeScript?.drills ?? []).map(d => ({
    notes:       '',
    show_notes:  false,
    cue_mp3_url: '',
    ...d,
  }))

  // ── Per-drill cue MP3 orchestration ────────────────────────────────────────
  // When a drill becomes active and has cue_mp3_url set:
  //   1. Capture whether the main playlist was playing.
  //   2. If yes, pause the main player (state-preserving — currentTime kept).
  //   3. Play the cue MP3 once via cuePlayer.
  //   4. When the cue ends naturally, resume the main player IFF it was
  //      playing before. If it was paused/stopped before the cue, leave it.
  //   5. If the drill changes again before the cue ends, the next iteration
  //      of this effect calls stopCue() (silent) + handles the new drill.
  //   6. If the user manually plays the main player while a cue is in flight,
  //      a separate subscription stops the cue and clears wasPlayingRef so
  //      we don't fight them on auto-resume.
  //
  // The "drill becomes active" trigger is currentDrillIdx changing while
  // hasStarted is true. Initial mount with hasStarted=false does not fire —
  // the cue at drill 0 plays only after the coach taps Start.
  const cueWasPlayingMainRef = useRef(false)
  const cueLastFiredIdxRef   = useRef(null)

  // (a) React to manual main-player state changes during cue playback.
  useEffect(() => {
    return subscribeAudio((type, payload) => {
      if (type !== 'state') return
      if (!isCuePlaying()) return
      // The orchestrator's own audioPause / audioResume calls happen BEFORE
      // a cue starts and AFTER it ends — neither is during cue playback —
      // so anything we observe here is the user's manual interaction.
      if (payload.isPlaying) {
        // User manually resumed main → stop cue, don't auto-resume after.
        stopCue()
        cueWasPlayingMainRef.current = false
      } else {
        // User manually paused main → don't auto-resume after the cue.
        cueWasPlayingMainRef.current = false
      }
    })
  }, [])

  // (b) Trigger the cue when the active drill changes.
  useEffect(() => {
    // Practice hasn't started → reset the "last fired" memo and bail. Any
    // in-flight cue from a prior session is also stopped.
    if (!hasStarted) {
      cueLastFiredIdxRef.current = null
      if (isCuePlaying()) {
        stopCue()
        if (cueWasPlayingMainRef.current) audioResume()
        cueWasPlayingMainRef.current = false
      }
      return
    }
    if (cueLastFiredIdxRef.current === currentDrillIdx) return
    cueLastFiredIdxRef.current = currentDrillIdx

    const drill = drills[currentDrillIdx]
    const cueUrl = drill?.cue_mp3_url

    // Drill changed → if a previous cue is still playing, abort it cleanly
    // and resume the main if we paused it for that prior cue.
    if (isCuePlaying()) {
      stopCue()
      if (cueWasPlayingMainRef.current) audioResume()
      cueWasPlayingMainRef.current = false
    }

    if (!cueUrl) return

    // Capture main-player state BEFORE pausing (snapshot is sync).
    const mainSnap = getAudioSnapshot()
    cueWasPlayingMainRef.current = !!mainSnap.isPlaying && mainSnap.currentIndex >= 0
    if (cueWasPlayingMainRef.current) audioPause()

    // Fire the cue. onEnded only runs on natural completion / load error.
    playCue(cueUrl, {
      onEnded: () => {
        if (cueWasPlayingMainRef.current) audioResume()
        cueWasPlayingMainRef.current = false
      },
    })
  }, [hasStarted, currentDrillIdx, drills])

  // ── Stage-mode controls panel (peek-handle slide-up) ──────────────────────
  // Default behavior: control panel is HIDDEN to maximize timer / drill-name
  // readability across the field/gym. A small grab-bar peeks at the bottom
  // edge — tap it (or drag up) to slide the panel up over the bottom of the
  // display zone. Auto-hide after 5 s of no panel interaction. Tap outside
  // the panel to close immediately.
  //
  // The panel itself is absolutely positioned at the bottom of the practice
  // section so it overlays the display zone when open. The display zone
  // stays full-height (flex-1) at all times — when the panel is closed the
  // display is unobstructed; when the panel is open it slides over the
  // bottom slice. We bump clock + drill-name font sizes when the panel is
  // closed because the clamp()-based sizes don't grow when the container
  // gets taller (clamp is viewport-relative, not container-relative).
  const [panelOpen, setPanelOpen] = useState(false)
  const hideTimerRef = useRef(null)
  // [DEBUG] Ref on the handle <button> so we can probe its bounding rect
  // at commit time. Used together with the console logs further down.
  const stripRef = useRef(null)

  function clearHideTimer() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }
  function armHideTimer() {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      setPanelOpen(false)
    }, 5000)
  }
  function openPanel() {
    setPanelOpen(true)
    armHideTimer()
  }
  function closePanel() {
    clearHideTimer()
    setPanelOpen(false)
  }
  function togglePanel() {
    markHandleSeen()
    if (panelOpen) closePanel()
    else openPanel()
  }
  // Any pointer/wheel/key event inside the panel resets the auto-hide clock.
  // Covers button taps, scrolls, drag-gestures, key presses — anything that
  // signals the operator is mid-interaction.
  function pokePanel() {
    if (panelOpen) armHideTimer()
  }
  // Cleanup on unmount so a stale timer doesn't fire after navigation.
  useEffect(() => () => clearHideTimer(), [])

  // ── First-use pulse animation for the peek handle ─────────────────────────
  // Stage mode is a brand-new affordance — without a hint, coaches couldn't
  // figure out how to bring controls back. The handle "breathes" until the
  // user has interacted with it once, then stops permanently (per browser /
  // device, via localStorage). If localStorage is unavailable (private
  // browsing, Safari ITP edge cases), we fall back to a 5-second timed
  // pulse on every load — strictly better than no hint at all.
  const HANDLE_SEEN_KEY = 'pp_stage_mode_handle_seen'
  const [showHandlePulse, setShowHandlePulse] = useState(() => {
    try {
      return localStorage.getItem(HANDLE_SEEN_KEY) !== '1'
    } catch {
      // localStorage blocked — pulse anyway; the timed fallback below
      // ensures we don't pulse forever.
      return true
    }
  })
  // Mark the handle as seen the first time the panel is interacted with.
  // Survives reloads via localStorage. Idempotent — safe to call again.
  function markHandleSeen() {
    setShowHandlePulse(false)
    try { localStorage.setItem(HANDLE_SEEN_KEY, '1') } catch {}
  }
  // Defensive timed fallback: kill the pulse after 8 s on every mount even
  // if the user never interacts. Guarantees the pulse is never permanent
  // (e.g. coach mounts the practice screen briefly while doing other work).
  // 8 s is long enough that a coach glancing at the screen will catch the
  // hint without being annoyed by indefinite motion.
  useEffect(() => {
    if (!showHandlePulse) return
    const t = setTimeout(() => setShowHandlePulse(false), 8000)
    return () => clearTimeout(t)
  }, [showHandlePulse])

  // [DEBUG] Diagnostics for the missing-on-iPad handle bug. Render-time
  // log of panelOpen + showHandlePulse so we can correlate symptom
  // (handle invisible) with state. Post-commit useEffect logs the
  // strip's bounding rect so we can see whether the element is in the
  // DOM, where it sits, and what dimensions the browser computes for
  // it. No deps array — runs after every render so we catch any
  // re-render that mutates the rect.
  console.log('[StageHandle] render — panelOpen:', panelOpen, 'showHandlePulse:', showHandlePulse)
  useEffect(() => {
    const rect = stripRef.current?.getBoundingClientRect()
    console.log('[StageHandle] rendered, strip dims:', rect)
  })

  // (Display-value destructure for `snap` and `drills` lives above the cue
  // orchestration effects so their dep arrays can read those names without
  // hitting the temporal dead zone in production builds. The remaining
  // derivations only used in render stay below.)
  const currentDrill = drills[currentDrillIdx]
  const nextDrill    = drills[currentDrillIdx + 1]
  const isLastDrill  = currentDrillIdx >= drills.length - 1

  const color        = isOverrun ? '#ef4444' : clockColor(secondsLeft, totalSeconds)
  const isDone       = hasStarted && !isRunning && secondsLeft === 0 && !isOverrun && isLastDrill && drills.length > 0
  const clockDisplay = isOverrun ? `+${fmt(overrunSeconds)}` : fmt(secondsLeft)

  // ── Render ──────────────────────────────────────────────────────────────────
  // Stage-mode layout. The DISPLAY ZONE fills the entire practice section so
  // the timer + drill names read across the field/gym. The CONTROLS PANEL is
  // absolutely positioned at the bottom and slides up/down over the display
  // zone via a CSS transform on a peek-handle tap. Auto-hides after 5 s.
  // Tapping the display zone while the panel is open closes the panel.
  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">

      {/* ── DISPLAY ZONE ────────────────────────────────────────────────────
          Background image lives here. Now fills the whole practice section;
          the controls panel slides up OVER the bottom slice when opened.
          Tap-to-close handler is here so any tap on the display closes an
          open panel — period dot taps still bubble through and fire jumpTo
          first via React's normal event order.

          paddingBottom reserves space for the absolutely-positioned peek
          handle strip below so the inner content (esp. the "Next Up /
          drill-name / mm:ss" block at the bottom) is never rendered
          behind the handle. The reserved height = handle bottom-offset
          (10) + handle strip height (44) + breathing room (10) = 64 px.
          The background image and dark overlay still fill the full box,
          so the handle visually sits on the same backdrop as the rest
          of the display. */}
      <div
        className="relative flex-1 flex flex-col overflow-hidden"
        onClick={panelOpen ? closePanel : undefined}
        style={{
          backgroundImage:    backgroundUrl ? `url(${backgroundUrl})` : undefined,
          backgroundSize:     'cover',
          backgroundPosition: 'center',
          // Reserve enough room at the bottom that the inner content
          // (esp. "Next Up / drill / mm:ss") never collides with the
          // peek handle below. Reservation = handle bottom-offset
          // (32 CSS px to clear the 68 px tab bar with breathing) +
          // handle strip height (44) + breathing room (10) +
          // safe-area-inset on iPads/iPhones with a home indicator.
          paddingBottom:      'calc(env(safe-area-inset-bottom, 0px) + 86px)',
        }}
      >
      {/* Adjustable dim overlay. Pre-2026-05-15 this was a hardcoded
          rgba(0,0,0,0.72) overlay that made every uploaded image look
          washed out. Coaches now control the level (0-100) via the
          Settings → Practice Screen Background slider; the new default
          is 0 (image as uploaded). We skip rendering the overlay when
          backgroundDim is 0 so the DOM stays minimal in the common
          case. */}
      {backgroundUrl && backgroundDim > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: `rgba(0,0,0,${Math.max(0, Math.min(100, backgroundDim)) / 100})` }}
        />
      )}

      <div className="relative z-10 flex-1 flex flex-col overflow-hidden px-4 gap-0">

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

        {/* ── 2. Current segment name (+ optional note) ─────────────────────── */}
        <div className="shrink-0 flex flex-col items-center pb-1" style={{ minHeight: 52 }}>
          {currentDrill ? (
            <>
              <h1
                className="text-center leading-none tracking-wide"
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  // Stage-mode bump: when the controls panel is hidden, drill
                  // name reads from across the room. clamp() is viewport-
                  // relative so we explicitly enlarge it here.
                  fontSize:   panelOpen
                    ? 'clamp(2.8rem, 6.5vw, 5rem)'
                    : 'clamp(3.5rem, 8.5vw, 6.5rem)',
                  color:      '#ffffff',
                  letterSpacing: '0.04em',
                  textShadow: '0 2px 24px rgba(0,0,0,0.8)',
                  transition: 'font-size 220ms ease-out',
                  // Drill name is rendered UPPERCASE everywhere it appears
                  // (display-only — the stored value keeps the coach's
                  // original casing). Bebas Neue is already a caps-only
                  // typeface so visually nothing changes here today, but
                  // the explicit text-transform protects against a future
                  // font-family swap silently breaking the all-caps look.
                  textTransform: 'uppercase',
                }}
              >
                {currentDrill.name}
              </h1>
              {/* Drill note — coaching cue under the name, only when THIS
                  drill's own show_notes flag is ON and the note is
                  non-empty. Each drill is opt-in independently.
                  Rendered with:
                    - 2× larger type than before (clamp 1.1–2.2 rem,
                      stage-mode-aware like the drill name) — small
                      enough to stay subordinate to the drill name,
                      large enough to read across a gym;
                    - near-full-white text;
                    - a dark rounded background plate so the note stays
                      legible against any uploaded background image
                      regardless of the bgDim setting. The plate makes
                      the note actually visible — pre-fix it sat at
                      0.85–1 rem in 70 % white with only a text shadow,
                      which on a default-0-dim background was
                      functionally invisible. */}
              {currentDrill.show_notes
                && currentDrill.notes
                && currentDrill.notes.trim() && (
                  <p
                    className="text-center mt-2 px-4 py-1.5 max-w-3xl whitespace-pre-wrap rounded-xl"
                    style={{
                      fontSize:        panelOpen
                        ? 'clamp(1.1rem, 1.8vw, 1.4rem)'
                        : 'clamp(1.4rem, 2.6vw, 2.2rem)',
                      color:           'rgba(255,255,255,0.96)',
                      lineHeight:      1.3,
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      textShadow:      '0 2px 10px rgba(0,0,0,0.85)',
                      transition:      'font-size 220ms ease-out',
                    }}
                  >
                    {currentDrill.notes}
                  </p>
                )}
            </>
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

        {/* ── 3. Timer ────────────────────────────────────────────────────────
            Previously this wrapper had a rounded green rectangle border +
            outer glow + inner glow (border / boxShadow), and a thin green
            progress bar lived directly below it. Both were removed for a
            cleaner stage-mode look — the timer numbers stand on their own.
            The wrapper is still a flex container so the clock stays
            vertically centered inside flex-1 space; just no chrome. */}
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <span
            className="font-mono font-black leading-none select-none"
            style={{
              // Stage-mode bump: when the panel is hidden, the clock fills
              // the freed vertical real estate so it reads from the back of
              // a gym. The smaller size mirrors the pre-stage-mode default.
              fontSize:           panelOpen
                ? 'clamp(5.5rem, 20vw, 13rem)'
                : 'clamp(7rem, 26vw, 17rem)',
              color,
              textShadow:         `0 0 100px ${color}88`,
              transition:         'color 0.6s, text-shadow 0.6s, font-size 220ms ease-out',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {clockDisplay}
          </span>
        </div>

        {/* (Divider removed — was a stray 1 px line between the timer and
            the "Next Up" block, leftover from the previous timer-frame
            removal in commit 03c8607. The bottom of the timer numbers
            now floats cleanly above "Next Up" with no horizontal rule
            bisecting the display.) */}

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
                  // UPPERCASE display, same rationale as the current-drill
                  // name above — defensive against a future font swap.
                  textTransform: 'uppercase',
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

      </div>
    </div>
    {/* ─ end DISPLAY ZONE ─ */}

    {/* ── CONTROLS PANEL (stage-mode slide-up) ──────────────────────────────
        Absolutely positioned at the bottom of the practice section. The
        panel = peek handle (always visible, 44px tall — Apple's minimum
        touch target) + controls strip (the rest). When closed we
        translateY by the controls strip's height, leaving only the
        handle showing. When open the whole panel slides into view.

        The peek handle is the tap target for toggling. Pointer-down events
        anywhere in the panel reset the auto-hide timer, so a coach
        actively pressing buttons / toggling preferences keeps the panel
        open. */}

    {/* Custom keyframes for the first-use pulse on the peek handle.
        We pulse the GRABBER PILL only — scale 1.0 → 1.15 → 1.0 over
        1.5 s. That's the universal sheet-handle "breathing" cue users
        recognize from iOS modal sheets. */}
    <style>{`
      @keyframes pp-handle-pill-pulse {
        0%, 100% { transform: scale(1);    }
        50%      { transform: scale(1.15); }
      }
    `}</style>

    <div
      className="absolute left-0 right-0 z-20"
      style={{
        // Bottom offset = breathing-gap above the tab bar (32 CSS px) +
        // env(safe-area-inset-bottom) for iPads/iPhones with home
        // indicator. The previous 10 px gap was too small on iPads in
        // PWA mode — confirmed via the b327360 magenta-strip diagnostic
        // which showed the handle's lower ~20 px clipped behind the
        // 68 px Dashboard nav. The Dashboard <nav> at fixed bottom-0
        // doesn't add safe-area padding itself, so we have to clear it
        // here on the panel side.
        bottom:        'calc(env(safe-area-inset-bottom, 0px) + 32px)',
        // CSS var: how far to slide down so only the handle peeks out.
        // Matches the controls strip height (estimated 132px — two stacked
        // rows of ~44 + ~28 + py-2 padding). The 44px peek handle stays
        // visible below it. Tweakable without breaking the open state
        // because the open state translates to 0.
        '--ctrls-h':   '132px',
        transform:     panelOpen ? 'translateY(0)' : 'translateY(var(--ctrls-h))',
        transition:    'transform 240ms ease-out',
        // Drop shadow above the panel when open so it visually separates
        // from the display zone behind it.
        boxShadow:     panelOpen ? '0 -10px 30px rgba(0,0,0,0.5)' : 'none',
      }}
      onPointerDown={pokePanel}
      onWheel={pokePanel}
      onKeyDown={pokePanel}
    >
      {/* PEEK HANDLE — full-width tap target on its OWN dedicated row,
          44 px tall (Apple HIG minimum touch target). Single horizontal
          row centered as a unit:
            [ Grabber pill (64×6 fully rounded, ~70% white) ] [ 8 px gap ]
            [ "CONTROLS" label (uppercase, ~60% white, ~1 px letterspace) ]
          Display zone above reserves 64 px of bottom padding so the
          "Next Up / drill / mm:ss" content never collides with this
          strip. */}
      {/* PEEK HANDLE — full-width tap target on its own dedicated row,
          44 px tall (Apple HIG minimum touch target). Single horizontal
          row centered as a unit:
            [ Grabber pill (64×6 fully rounded, ~70% white) ] [ 10 px gap ]
            [ "CONTROLS" label (uppercase, ~70% white, 1 px letter-space) ]
          The display zone above reserves 86 px + safe-area-inset of
          bottom padding so the "Next Up / drill / mm:ss" content never
          collides with this strip. */}
      <button
        ref={stripRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); togglePanel() }}
        aria-label={panelOpen ? 'Hide controls' : 'Show controls'}
        aria-expanded={panelOpen}
        className="w-full flex flex-row items-center justify-center select-none relative"
        style={{
          height:          44,
          gap:             10,
          // Gradient fades the panel chrome into the display zone — dark
          // at the bottom, semi-transparent at the top — so the handle
          // reads as "the bottom of the screen" rather than a hard band.
          // When the panel is open the gradient flips to a solid #080000
          // so it visually joins the controls strip below.
          background:      panelOpen
            ? '#080000'
            : `linear-gradient(to top, rgba(8,0,0,0.96) 0%, rgba(8,0,0,0.78) 60%, rgba(8,0,0,0.45) 100%)`,
          borderTop:       panelOpen
            ? '1px solid #1a0000'
            : `1px solid ${orgColor}44`,
          cursor:          'pointer',
        }}
      >
        {/* Grabber pill — universal iOS-sheet handle. 64×6 fully rounded,
            ~70% white. Scale-pulses 1.0 → 1.15 → 1.0 over 1.5 s while the
            first-use hint is active; halts permanently on first tap (or
            after the 8 s fallback). */}
        <span
          style={{
            width:           64,
            height:          6,
            borderRadius:    9999,
            backgroundColor: 'rgba(255,255,255,0.7)',
            boxShadow:       (showHandlePulse && !panelOpen)
              ? `0 0 12px ${orgColor}cc, 0 0 4px rgba(255,255,255,0.6)`
              : '0 1px 2px rgba(0,0,0,0.6)',
            animation:       (showHandlePulse && !panelOpen)
              ? 'pp-handle-pill-pulse 1.5s ease-in-out infinite'
              : 'none',
            transformOrigin: 'center',
            transition:      'box-shadow 200ms',
          }}
        />

        {/* CONTROLS label — sits to the RIGHT of the pill, vertically
            centered with it on the same horizontal line (NOT above, NOT
            below). Only shown when the panel is closed; redundant noise
            once the controls strip itself is visible. */}
        {!panelOpen && (
          <span
            aria-hidden="true"
            style={{
              fontSize:      12,
              lineHeight:    1,
              fontWeight:    700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              color:         'rgba(255,255,255,0.7)',
              textShadow:    '0 1px 2px rgba(0,0,0,0.7)',
            }}
          >
            Controls
          </span>
        )}
      </button>

      {/* CONTROLS STRIP ─ original content, now the body of the slide panel.
          Solid #080000 background and hard top edge same as before, so
          coaches can still crop the display zone above for ProPresenter /
          AirPlay when the panel is open. */}
    <div
      className="flex items-center justify-between gap-3 px-4 py-2"
      style={{ backgroundColor: '#080000', borderTop: '1px solid #1a0000' }}
    >

      {/* LEFT — music mini-controls (unchanged styling) */}
      <MusicMiniControls orgColor={orgColor} />

      {/* CENTER — transport row above toggle row, tight stack */}
      <div className="flex-1 min-w-0 flex flex-col items-center gap-1">

        {/* ── 6 & 7. Control row ───────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-2 flex-wrap">

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
        <div className="flex items-center justify-center gap-3 flex-wrap">
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
            label="Bell 0:30"
            active={bellAt30}
            onColor={orgColor}
            onClick={() => setBellAt30(!bellAt30)}
          />
          <ToggleBtn
            label="Stop Music at End"
            active={stopMusicOnEnd}
            onColor={orgColor}
            onClick={() => setStopMusicOnEnd(!stopMusicOnEnd)}
          />
        </div>

      </div>
      {/* end CENTER */}

      {/* RIGHT — crowd noise toggle (unchanged styling + label) */}
      <StadiumNoiseToggle orgColor={orgColor} />

    </div>
    {/* ─ end CONTROLS STRIP ─ */}

    </div>
    {/* ─ end CONTROLS PANEL (slide wrapper) ─ */}

    </div>
  )
}
