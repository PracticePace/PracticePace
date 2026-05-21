// ── StadiumNoiseToggle ──────────────────────────────────────────────────────
// Stand-alone widget wired to the stadiumNoise singleton in
// src/lib/stadiumNoise.js. Tap to start the looping stadium-noise track
// at full volume; tap again to stop. Does NOT participate in horn/voice
// ducking or the music player.
//
// Used by both PracticeSection and the four sub-scoreboards inside
// ScoreboardSection. The button is self-contained — it owns its own
// subscription to the stadium-noise snapshot and re-renders on state
// changes from anywhere (a stop triggered on the Practice tab updates
// the indicator on the Scoreboard tab and vice-versa, because they
// both subscribe to the same module-level singleton).
//
// Prop:
//   orgColor — for the "on" fill, focus ring tint, and label color.
//              Defaults to PracticePace red if not passed.
//
// Visual:
//   44 × 44 button (Apple HIG touch target), megaphone icon (lucide),
//   permanent CROWD label underneath so the affordance reads
//   unambiguously. State changes: filled in orgColor + glow when ON,
//   dim outline when OFF.

import { useEffect, useState } from 'react'
import {
  subscribe as subscribeStadium,
  getSnapshot as getStadiumSnapshot,
  toggle as toggleStadium,
} from '../lib/stadiumNoise'

const MegaphoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
)

export default function StadiumNoiseToggle({ orgColor = '#cc1111' }) {
  const [snap, setSnap] = useState(() => getStadiumSnapshot())
  useEffect(() => subscribeStadium(setSnap), [])
  const isOn = !!snap.isPlaying

  return (
    <div className="shrink-0 flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => toggleStadium().catch(() => {})}
        aria-label={isOn ? 'Stop stadium noise' : 'Play stadium noise'}
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
