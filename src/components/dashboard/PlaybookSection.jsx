// ── PlaybookSection.jsx ───────────────────────────────────────────────────────
// Coach quick-start guide / FAQ. Lives as its own tab at the right edge of
// the bottom nav. (Briefly relocated into Settings as "Help & Guide" in
// commit 442baeb; restored to a dedicated tab in this commit because the
// help cards crowded the actual settings.)
//
// Content was last verified accurate against the shipped app on 2026-05-08
// (commit 8f29bce); a Whiteboard section was added on 2026-05-10
// (commit 442baeb) when that feature shipped. Update sites where features
// change:
//   • Stage Mode peek-handle behaviour       → 'display'  section
//   • Bell-at-0:30 / horn / cue-MP3 details  → 'music'    section
//   • Role permissions                       → 'coaching-staff' section
//   • Print-Script + per-drill features      → 'scripts'  section
//   • Whiteboard feature                     → 'whiteboard' section
//   • +1m / −1m / preset buttons             → 'tips'     section

// ── Card icons ────────────────────────────────────────────────────────────────
// Stroked SVGs replacing the previous emoji glyphs — emoji render differently
// per-platform and can't take the program's brand colour. These inherit
// currentColor, so SectionCard tints them with orgColor the same way the ✦
// bullets are tinted. Shape convention (24px box, 2px stroke, round caps)
// matches the existing icons in Dashboard.jsx and WhiteboardSection.jsx.
const Ico = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
const ZapIcon       = () => <Ico><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ico>
const ClipboardIcon = () => <Ico><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/></Ico>
const MonitorIcon   = () => <Ico><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></Ico>
const MusicIcon     = () => <Ico><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></Ico>
const TrophyIcon    = () => <Ico><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></Ico>
const UsersIcon     = () => <Ico><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Ico>
const PencilIcon    = () => <Ico><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></Ico>
const ScriptIcon    = () => <Ico><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></Ico>
const BulbIcon      = () => <Ico><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></Ico>

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Better Startup',
    Icon: ZapIcon,
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
    Icon: ClipboardIcon,
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
    Icon: MonitorIcon,
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
    Icon: MusicIcon,
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
    Icon: TrophyIcon,
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
    Icon: UsersIcon,
    items: [
      'Invite coaches in Settings → Coaches & Staff → Send Invite.',
      'Coaches receive an email invite and set their own password, then land directly in your account’s dashboard.',
      'Athletic Director — full access including subscription and billing. The Athletic Director is the person who created the account. (On a single-program account, this role displays as "Head Coach".)',
      'Head Coach — can manage coaches, edit the program logo, and use all practice tools. Cannot access billing.',
      'Assistant Coach — can run practice, edit scripts and drills, and use all practice tools. Cannot manage coaches or edit program settings.',
      'Team Manager — view-only. Can run a practice, view scripts and drills, and watch the whiteboard, but cannot create or edit anything and cannot run the scoreboard.',
    ],
  },
  {
    id: 'whiteboard',
    title: 'Whiteboard',
    Icon: PencilIcon,
    items: [
      'Tap the Whiteboard tab to draw plays with your finger or Apple Pencil. Whatever you draw shows on the AirPlay-mirrored jumbotron in real time.',
      'Choose a background to draw on: Blank (white), Football field, Basketball court, Soccer pitch, and more — pick whichever surface fits the play.',
      'Color picker, thickness options, and eraser tool let you sketch in detail.',
      'Use Undo and Redo to step back and forward through your strokes.',
      'Tap Clear to wipe the whole board and start fresh.',
      'Drawings persist until you manually clear them — switch tabs, close the app, come back later, your board is still there.',
    ],
  },
  {
    id: 'scripts',
    title: 'Scripts & Drills',
    Icon: ScriptIcon,
    items: [
      'Build a script in the Scripts tab — name it, set the sport, add drills.',
      'Each drill has a name, duration, optional notes, and an optional cue MP3.',
      'Toggle "Show on practice screen" per drill to display its note under the drill name during practice.',
      'Reorder drills with drag-and-drop, edit any drill inline, or delete with the X.',
      'When you tap Add Drill, the cursor lands in the drill name field automatically — start typing right away.',
      'Drill names display in ALL CAPS on the practice screen and on the printed script, no matter how you type them.',
      'Tap "🖨 Print Script" to get a printable practice plan with auto-calculated times and a Notes column wide enough for handwriting — just enter your practice start time when prompted.',
    ],
  },
  {
    id: 'tips',
    title: 'Tips & Tricks',
    Icon: BulbIcon,
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

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, Icon, items, orgColor }) {
  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-2xl"
      style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span style={{ color: orgColor, lineHeight: 0 }}>{Icon ? <Icon /> : null}</span>
        <h2
          className="font-black tracking-widest uppercase"
          style={{
            fontFamily:    "'Bebas Neue', sans-serif",
            fontSize:      '1.15rem',
            // Category titles are intentionally white rather than orgColor —
            // the card's icon and ✦ bullets still carry the org's brand color.
            color:         '#ffffff',
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

      {/* Page intro — left-text / right-image split, both halves vertically
          centred in the same row (per the Boostr mockup). The image is shown
          in full rather than cropped: width-constrained with h-auto so its
          natural 3:2 aspect ratio is preserved at every breakpoint. Stacks to
          a single column below md, image first so it still reads as a header. */}
      <div className="px-4 md:px-6 pt-6 pb-2">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-8 items-center">
          {/* Left — title + copy */}
          <div className="flex flex-col gap-2 order-2 md:order-1">
            <h1
              className="font-black tracking-widest uppercase"
              style={{
                fontFamily:    "'Bebas Neue', sans-serif",
                fontSize:      'clamp(1.8rem, 4vw, 2.4rem)',
                color:         '#ffffff',
                letterSpacing: '0.1em',
                lineHeight:    1.05,
              }}
            >
              Optimal settings for{' '}
              <span style={{ color: orgColor }}>Practice:Pace</span>
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
              Practice:Pace will operate at top speed on this device, but these
              settings ensure the best experience for optimal use.
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

          {/* Right — hero image, uncropped */}
          <div className="order-1 md:order-2">
            <img
              src="/marketing/weightlifting.png"
              alt="An athlete setting up for a deadlift in a weight room."
              className="w-full h-auto rounded-xl"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div className="p-4 md:p-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {SECTIONS.map(s => (
            <SectionCard
              key={s.id}
              title={s.title}
              Icon={s.Icon}
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
