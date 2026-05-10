// ── HelpAndGuide.jsx ──────────────────────────────────────────────────────────
// Coach quick-start guide / FAQ content. Previously rendered as its own tab
// ("Playbook") at the bottom of the Dashboard, but moved into Settings as a
// "Help & Guide" section when that tab slot was repurposed for the new
// Whiteboard feature. Rendered at the TOP of SettingsSection so coaches see
// it without scrolling.
//
// Content was last verified accurate against the shipped app on 2026-05-08
// (commit 8f29bce). Update sites where features change:
//   • Stage Mode peek-handle behaviour       → 'display'  section
//   • Bell-at-0:30 / horn / cue-MP3 details  → 'music'    section
//   • Role permissions                       → 'coaching-staff' section
//   • Print-Script + per-drill features      → 'scripts'  section
//   • +1m / −1m / preset buttons             → 'tips'     section

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '⚡',
    items: [
      'Best viewed on an iPad running Safari as a PWA — tap Share → Add to Home Screen for the full experience.',
      'Sign in and set up your program in Settings before your first practice.',
      'Build your first practice script in the Scripts tab.',
      'Upload your team background and program logo in Settings.',
    ],
  },
  {
    id: 'practice-day',
    title: 'Practice Day Setup',
    icon: '📋',
    items: [
      'Open PracticePace on your iPad before practice begins.',
      'Load your script in the Scripts tab — tap Set Active.',
      'Go to the Practice tab — your script loads automatically.',
      'Keep PracticePace as the active app during practice — switching apps may pause the timer.',
      'For best results, set iPad Auto-Lock to Never during practice: Settings → Display & Brightness → Auto-Lock → Never.',
    ],
  },
  {
    id: 'display',
    title: 'Display & Mirroring',
    icon: '📺',
    items: [
      'Mirror the iPad to a TV or jumbotron via AirPlay or HDMI for the best sideline display experience.',
      'The practice timer is designed to be readable from 30+ yards away.',
      'Your team background image shows behind the timer on the display screen.',
      'Stage Mode hides the controls automatically so the timer fills the screen — tap the CONTROLS handle at the bottom to bring controls up, and they’ll auto-hide after a few seconds of inactivity.',
    ],
  },
  {
    id: 'music',
    title: 'Music',
    icon: '🎵',
    items: [
      'Use the Music tab to upload MP3s and build a practice playlist. Music plays through the iPad speaker or any connected Bluetooth speaker.',
      'The mini player bar at the top of the Music tab gives you full controls: play, pause, skip, volume, shuffle, and loop.',
      'Music controls are also available inside the Practice tab’s slide-up controls panel — tap CONTROLS at the bottom of the screen to bring them up.',
      'Attach a cue MP3 to any drill in the Scripts editor — when that drill starts, the playlist pauses, the cue plays once, and your playlist picks up where it left off.',
      'The air horn automatically ducks the music volume so you can hear it clearly. Music returns to full volume right after.',
      'A bell sounds at 0:30 remaining on each drill — toggle it off in the practice controls if you don’t want it.',
      'Crowd noise: tap the megaphone icon in the controls panel to play continuous stadium crowd noise. Loops until you turn it off. Plays alongside your music — adjust the iPad volume or pause your music if you want crowd noise to dominate.',
      'For maximum volume: turn the iPad volume to 100% and pair with a Bluetooth speaker positioned toward the field. The app’s audio cannot go louder than the iPad’s system volume.',
    ],
  },
  {
    id: 'scoreboard',
    title: 'Scoreboards',
    icon: '🏆',
    items: [
      'Tap the Scoreboard tab and select your sport.',
      'Football — game clock, down & distance, play clock, timeouts.',
      'Basketball — game clock, shot clock, fouls, timeouts, quarters or halves.',
      'Tap the game clock to set any time manually.',
      'Shot clock hot buttons: 35s (college), 24s (NBA/varsity), 14s (inbound).',
    ],
  },
  {
    id: 'coaching-staff',
    title: 'Coaching Staff',
    icon: '👥',
    items: [
      'Invite coaches in Settings → Coaches & Staff → Send Invite.',
      'Coaches receive an email invite and set their own password, then land directly in your account’s dashboard.',
      'Owner — full access including subscription and billing. The owner is the person who created the account.',
      'Admin — can manage coaches, edit the program logo, and use all practice tools. Cannot access billing.',
      'Coach — can run practice, edit scripts, and use all practice tools.',
      'Read-only — listed as read-only in the Coaches & Staff directory. Note: stricter view-only enforcement is in development.',
    ],
  },
  {
    id: 'scripts',
    title: 'Scripts & Drills',
    icon: '📝',
    items: [
      'Build a script in the Scripts tab — name it, set the sport, add drills.',
      'Each drill has a name, duration, optional notes, and an optional cue MP3.',
      'Toggle "Show on practice screen" per drill to display its note under the drill name during practice.',
      'Reorder drills with drag-and-drop, edit any drill inline, or delete with the X.',
      'Tap "🖨 Print Script" to get a printable practice plan with auto-calculated times and a Notes column wide enough for handwriting — just enter your practice start time when prompted.',
    ],
  },
  {
    id: 'whiteboard',
    title: 'Whiteboard',
    icon: '✏️',
    items: [
      'Open the Whiteboard tab to draw plays, diagram routes, or sketch coverages with your finger or Apple Pencil.',
      'Mirror to the Apple TV / jumbotron the same way as the practice timer — the whiteboard fills the screen so everyone can see.',
      'Pick a color, thickness, or the eraser. The Football background draws a regulation field with yard lines and hash marks.',
      'Undo / Redo for the last 50 strokes. The drawing saves automatically and persists across sessions until you tap Clear.',
    ],
  },
  {
    id: 'tips',
    title: 'Tips & Tricks',
    icon: '⚡',
    items: [
      'Use the +1m / −1m buttons during practice to adjust the active period on the fly. Preset buttons (5m / 10m / 15m / 20m) jump to a specific time.',
      'The Next button blows the air horn and starts the next drill.',
      'Auto-Advance moves to the next drill automatically when the timer hits zero.',
      'Allow Overrun lets the timer count past zero — great for competitive periods.',
      'Save multiple scripts — build Monday through Friday in advance.',
      'Tap any dot in the drill progress row to jump directly to that period.',
    ],
  },
]

function HelpCard({ title, icon, items, orgColor }) {
  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-2xl"
      style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{icon}</span>
        <h3
          className="font-black tracking-widest uppercase"
          style={{
            fontFamily:    "'Bebas Neue', sans-serif",
            fontSize:      '1.05rem',
            color:         orgColor,
            letterSpacing: '0.1em',
          }}
        >
          {title}
        </h3>
      </div>

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: '#2a0000' }} />

      {/* Items */}
      <ul className="flex flex-col gap-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className="shrink-0 mt-0.5 font-black text-xs"
              style={{ color: orgColor, lineHeight: '1.5rem' }}
            >
              ✦
            </span>
            <span className="text-sm leading-relaxed" style={{ color: '#c8a0a0' }}>
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function HelpAndGuide({ orgColor = '#cc1111' }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          className="font-black tracking-widest uppercase"
          style={{
            fontFamily:    "'Bebas Neue', sans-serif",
            fontSize:      'clamp(1.4rem, 2.4vw, 1.8rem)',
            color:         orgColor,
            letterSpacing: '0.1em',
            lineHeight:    1.05,
          }}
        >
          Help &amp; Guide
        </h2>
        <p className="text-xs" style={{ color: '#7a5050' }}>
          Quick-start guide. For technical help, email{' '}
          <a
            href="mailto:practicepace@gmail.com"
            className="underline transition-opacity hover:opacity-80"
            style={{ color: orgColor }}
          >
            practicepace@gmail.com
          </a>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SECTIONS.map(s => (
          <HelpCard
            key={s.id}
            title={s.title}
            icon={s.icon}
            items={s.items}
            orgColor={orgColor}
          />
        ))}
      </div>
    </div>
  )
}
