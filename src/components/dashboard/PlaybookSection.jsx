// ── PlaybookSection.jsx ───────────────────────────────────────────────────────
// Coach quick-start guide built into the dashboard.

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: '⚡',
    items: [
      'Best viewed on an iPad running Safari as a PWA — tap Share → Add to Home Screen for the full experience.',
      'Sign in and set up your program in Settings before your first practice.',
      'Build your first practice script in the Scripts tab.',
      'Upload your team background image in Settings → Practice Screen Background.',
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
    title: 'Display & AirPlay',
    icon: '📺',
    items: [
      'AirPlay to a TV or monitor for the best sideline display experience.',
      'The practice timer is designed to be readable from 30+ yards away.',
      'Your team background image shows behind the timer on the display screen.',
      'Tap the Display tab to open the full-screen timer view for AirPlay.',
    ],
  },
  {
    id: 'music',
    title: 'Music',
    icon: '🎵',
    items: [
      'Use the Music tab to upload MP3s and build a practice playlist. Music plays through the iPad speaker or any connected Bluetooth speaker.',
      'The mini player bar at the top of the music tab gives you full controls: play, pause, skip, volume, shuffle, and loop.',
      'Quick controls in the bottom-left of the practice tab let you play, pause, and skip songs without leaving the practice screen. They show up automatically once you’ve added music to your library.',
      'The air horn and the “next up” voice announcement automatically duck the music volume so you can still hear them clearly. Music returns to full volume right after.',
      'Crowd noise: tap the megaphone icon in the bottom-right of the practice tab to play continuous stadium crowd noise. Loops until you turn it off. Plays alongside your music — adjust the iPad volume or pause your music if you want the crowd noise to dominate.',
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
      'Coaches receive an email invite and set their own password.',
      'Admin — full access including settings and billing.',
      'Coach — can run practice, edit scripts, and use all practice tools.',
      'Read-only — view only, cannot edit scripts or settings.',
    ],
  },
  {
    id: 'tips',
    title: 'Tips & Tricks',
    icon: '⚡',
    items: [
      'Use the +1m button during practice to extend a period on the fly.',
      'The Next button blows the air horn and automatically starts the next drill.',
      'Auto-Advance moves to the next drill automatically when the timer hits zero.',
      'Allow Overrun lets the timer count past zero — great for competitive periods.',
      'Save multiple scripts — build Monday through Friday in advance.',
      'Tap any dot in the drill progress row to jump directly to that period.',
    ],
  },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, icon, items, orgColor }) {
  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-2xl"
      style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{icon}</span>
        <h2
          className="font-black tracking-widest uppercase"
          style={{
            fontFamily:    "'Bebas Neue', sans-serif",
            fontSize:      '1.15rem',
            color:         orgColor,
            letterSpacing: '0.1em',
          }}
        >
          {title}
        </h2>
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

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PlaybookSection({ orgColor = '#cc1111' }) {
  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page header */}
      <div
        className="sticky top-0 z-10 px-4 md:px-6 py-3 flex items-center gap-3"
        style={{ backgroundColor: '#0d0000', borderBottom: '1px solid #1a0000' }}
      >
        <h1
          className="font-black tracking-widest uppercase"
          style={{
            fontFamily:    "'Bebas Neue', sans-serif",
            fontSize:      '1.4rem',
            color:         orgColor,
            letterSpacing: '0.12em',
          }}
        >
          Coach Playbook
        </h1>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#4a2020' }}>
          Quick-Start Guide
        </span>
      </div>

      {/* Page intro — sits above the section cards */}
      <div className="px-4 md:px-6 pt-6 pb-2">
        <div className="max-w-4xl mx-auto flex flex-col gap-2">
          <h1
            className="font-black tracking-widest uppercase"
            style={{
              fontFamily:    "'Bebas Neue', sans-serif",
              fontSize:      'clamp(1.8rem, 4vw, 2.4rem)',
              color:         orgColor,
              letterSpacing: '0.1em',
              lineHeight:    1.05,
            }}
          >
            Optimal settings for Practice:Pace
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
            Practice:Pace will operate on any computer or tablet, but these are
            suggestions for optimal use.
          </p>
          <p className="text-xs" style={{ color: '#7a5050' }}>
            For technical help, email{' '}
            <a
              href="mailto:practicepace@gmail.com"
              className="underline transition-opacity hover:opacity-80"
              style={{ color: orgColor }}
            >
              practicepace@gmail.com
            </a>
          </p>
        </div>
      </div>

      {/* Cards grid */}
      <div className="p-4 md:p-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {SECTIONS.map(s => (
            <SectionCard
              key={s.id}
              title={s.title}
              icon={s.icon}
              items={s.items}
              orgColor={orgColor}
            />
          ))}
        </div>

        {/* Footer note */}
        <p
          className="max-w-4xl mx-auto mt-6 text-xs text-center"
          style={{ color: '#3a1818' }}
        >
          PracticePace — Practice smarter. Win more.
        </p>
      </div>
    </div>
  )
}
