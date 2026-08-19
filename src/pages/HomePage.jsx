// Home page — the /  marketing landing (Boostr rebuild Commit 2).
//
// Structure (top-to-bottom):
//   • MarketingHeader (sticky, from Commit 1 stub)
//   • Hero — full-viewport text-left + football photo-right
//   • Sport tiles (4-up: Football, Basketball, Cheer, Weightlifting)
//   • System features + video preview thumbnail (opens VideoModal)
//   • Testimonials (Patrick / Antonio / Adam)
//   • ReadyToMaximize (from Commit 1 stub)
//   • MarketingFooter (from Commit 1 stub)
//
// Header / CTA / Footer are rendered inline here — matching the Commit 1
// per-page pattern. Commit 2 spec assumed an Outlet layout wraps every
// marketing page, but Commit 1 chose per-page inline; keeping that here
// to avoid a routing refactor in this content commit. Practically
// identical outcome either way (Header shows above, CTA + Footer show
// below).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import MarketingHeader  from '../components/marketing/MarketingHeader'
import MarketingFooter  from '../components/marketing/MarketingFooter'
import ReadyToMaximize  from '../components/marketing/ReadyToMaximize'
import VideoModal       from '../components/marketing/VideoModal'

// ── Inline SVG icons (Commit 1 convention: no lucide-react dep) ────────────
// Currently used by the four rows in Section 3's features list. Small,
// stroke-based, currentColor so callers control the tint via CSS.
const ClockIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)
const ChevronRightIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)
const MusicNoteIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
)
const LayoutDashboardIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" />
    <rect x="14" y="3" width="7" height="5" />
    <rect x="14" y="12" width="7" height="9" />
    <rect x="3" y="16" width="7" height="5" />
  </svg>
)
const PlayIcon = () => (
  <svg width="40%" height="40%" viewBox="0 0 24 24" fill="var(--color-brand-red)"
       aria-hidden="true">
    <polygon points="7 4 21 12 7 20" />
  </svg>
)

// ── Data — kept out of JSX so the sections stay scannable ──────────────────
const SPORT_TILES = [
  {
    key:     'football',
    image:   '/marketing/practice-football-2.jpg',
    alt:     'Football players in a practice drill on the field.',
    title:   'Football',
    tagline: 'Build Tough. Practice Smarter.',
  },
  {
    key:     'basketball',
    image:   '/marketing/practice-basketball-1.jpg',
    alt:     'Basketball players running a practice drill on the court.',
    title:   'Basketball',
    tagline: 'Fast-Paced. Game Ready.',
  },
  {
    key:     'cheer',
    image:   '/marketing/practice-cheer-1.jpg',
    alt:     'Cheerleaders running a stunt sequence during practice.',
    title:   'Cheer',
    tagline: 'Sharp. Confident. Competition Ready.',
  },
  {
    // Internal key stays 'wrestling' — this slot was originally Wrestling
    // and was swapped to Weightlifting per Boostr. Only user-visible
    // fields (image, alt, title) changed; tagline preserved per Boostr's
    // explicit request. Renaming the key is out of scope.
    key:     'wrestling',
    image:   '/marketing/weightlifting.png',
    alt:     'An athlete lifting weights during a workout.',
    title:   'Weightlifting',
    tagline: 'Relentless Effort. Every Second.',
  },
]

const SYSTEM_FEATURES = [
  { icon: <ClockIcon />,            label: 'Performance Clock', body: 'Keep practices on track and athletes engaged.' },
  { icon: <ChevronRightIcon />,     label: 'Next Up',           body: 'Transition faster. Waste no time.' },
  { icon: <MusicNoteIcon />,        label: 'GameSound',         body: 'Pump up your team with custom audio.' },
  { icon: <LayoutDashboardIcon />,  label: 'Command Center',    body: 'Your entire practice, organized in one place.' },
]

// Real testimonials — already used on the pre-rebuild landing page
// (Slots 1, 2, 4 landed live via commits 32fde5f / 038b512 / 307e5e6).
// Trimmed variants match what shipped on Patrick's slot; the other two
// quotes are the approved full-length versions.
const TESTIMONIALS = [
  {
    quote:   "PracticePace has been a tremendous addition to how we run practice. I no longer find myself constantly looking down at a paper practice plan — our staff can keep our attention on teaching, correcting, and coaching players. The built-in scoreboard and shot clock have been a huge help, too. No more finding someone to run the clock during practice.",
    name:    'Patrick Harding',
    program: 'Head Basketball Coach, Whitesburg Christian Academy',
  },
  {
    quote:   "Practice:Pace is a complete game changer. We started using it this past Spring and the results were phenomenal. We now have nearly seamless transitions in practice. Everyone is constantly aware of where we are in practice, how much time is remaining in the current period, and what is coming next. I highly recommend this app for any program seriously seeking next level organization.",
    name:    'Antonio Ford',
    program: 'Defensive Coordinator, Albertville High School',
  },
  {
    quote:   "Practice:Pace has completely changed how we run our practices. We upload our schedule and it runs directly on our video board, keeping our entire staff and players on the same page without anyone having to watch a clock. This program blows away any other practice software we have seen — if you run a football program and want to maximize every minute of practice, Practice:Pace is a tool you need.",
    name:    'Adam Winegarden',
    program: 'Head Football Coach, Albertville High School',
  },
]

export default function HomePage() {
  const [videoOpen, setVideoOpen] = useState(false)

  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh' }}>
      <MarketingHeader />

      {/* ───────────────────────── SECTION 1 — HERO ───────────────────────── */}
      <section className="bg-black">
        <div
          className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-8 lg:gap-12 items-center px-6"
          style={{ minHeight: '90vh' }}
        >
          {/* Left — text stack. Order-2 on mobile so text lands ABOVE image;
              lg:order-1 puts it back on the left on desktop. */}
          <div className="flex flex-col gap-6 py-12 order-2 lg:order-1">
            <h1
              className="font-display uppercase leading-none tracking-wide"
              style={{ fontSize: 'clamp(3.5rem, 11vw, 9rem)' }}
            >
              <span className="block text-white">Every</span>
              <span className="block text-brand-red">Second</span>
              <span className="block text-white">Matters.</span>
            </h1>
            <p
              className="font-display uppercase text-white"
              style={{ fontSize: 'clamp(1.15rem, 2.4vw, 1.9rem)', letterSpacing: '0.08em' }}
            >
              Run practice like game day.
            </p>
            <p
              className="font-body text-white max-w-md"
              style={{ fontSize: '1rem', lineHeight: 1.6 }}
            >
              Practice:Pace helps coaches create better practices, build
              stronger athletes and win more games.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-2">
              <Link
                to="/login"
                className="font-button uppercase text-white text-center transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--color-brand-red)',
                  padding:         '14px 28px',
                  letterSpacing:   '0.08em',
                  borderRadius:    '4px',
                  fontSize:        '1rem',
                }}
              >
                Get Started
              </Link>
              <button
                type="button"
                onClick={() => setVideoOpen(true)}
                className="font-button uppercase text-white text-center transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'transparent',
                  border:          '2px solid var(--color-brand-red)',
                  padding:         '12px 28px',
                  letterSpacing:   '0.08em',
                  borderRadius:    '4px',
                  fontSize:        '1rem',
                }}
              >
                Watch Demo
              </button>
            </div>
          </div>

          {/* Right — hero photo. On desktop fills the column; on mobile
              caps at ~50vh so it doesn't push the CTAs off-screen. Slight
              left-edge gradient bleeds the image into the text side. */}
          <div className="relative order-1 lg:order-2 w-full" style={{ minHeight: 'min(50vh, 500px)' }}>
            <img
              src="/marketing/practice-cheer-3.jpg"
              alt="Cheerleaders celebrating mid-routine under stadium lights."
              className="w-full h-full object-cover"
              style={{ minHeight: 'min(50vh, 500px)', maxHeight: '85vh' }}
              loading="eager"
              decoding="async"
            />
            <div
              className="hidden lg:block absolute inset-y-0 left-0 w-1/4 pointer-events-none"
              style={{ background: 'linear-gradient(to right, #000 0%, transparent 100%)' }}
            />
          </div>
        </div>
      </section>

      {/* ─────────────────────── SECTION 2 — SPORT TILES ─────────────────────── */}
      <section className="bg-black py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {SPORT_TILES.map(t => (
              <div
                key={t.key}
                className="relative overflow-hidden rounded-md group"
                style={{ aspectRatio: '3 / 4' }}
              >
                <img
                  src={t.image}
                  alt={t.alt}
                  className="w-full h-full object-cover transition-all duration-300 group-hover:scale-105 group-hover:brightness-110"
                  loading="lazy"
                />
                {/* Bottom gradient for text legibility, ~2/3 of the tile. */}
                <div
                  className="absolute inset-x-0 bottom-0 pointer-events-none"
                  style={{
                    height:     '66%',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 40%, transparent 100%)',
                  }}
                />
                <div className="absolute inset-x-0 bottom-0 p-4 md:p-5 flex flex-col gap-1 pointer-events-none">
                  <h3
                    className="font-display uppercase text-white leading-none tracking-wide"
                    style={{ fontSize: 'clamp(1.75rem, 2.5vw, 2.25rem)' }}
                  >
                    {t.title}
                  </h3>
                  <p
                    className="font-body"
                    style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.85rem', lineHeight: 1.35 }}
                  >
                    {t.tagline}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────── SECTION 3 — SYSTEM FEATURES + VIDEO PREVIEW ─────────────── */}
      <section className="bg-black py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left column — eyebrow + headline + intro + 4 feature rows */}
          <div className="flex flex-col gap-6">
            <span
              className="font-display uppercase text-brand-red"
              style={{ fontSize: '0.85rem', letterSpacing: '0.18em' }}
            >
              The Practice:Pace System
            </span>
            <h2
              className="font-display uppercase text-white leading-none tracking-wide"
              style={{ fontSize: 'clamp(2.25rem, 5.5vw, 3.75rem)' }}
            >
              <span className="block">Designed for Coaches.</span>
              <span className="block">Built for Results.</span>
            </h2>
            <p
              className="font-body text-white max-w-lg"
              style={{ fontSize: '1rem', lineHeight: 1.6 }}
            >
              Practice:Pace gives you the tools to plan, pace and perfect
              every practice. From warmups to game simulations, we help you
              maximize every minute.
            </p>

            <div className="flex flex-col gap-5 mt-4">
              {SYSTEM_FEATURES.map(f => (
                <div key={f.label} className="flex items-start gap-4">
                  <div className="shrink-0 text-brand-red mt-1" aria-hidden="true">{f.icon}</div>
                  <div>
                    <h3
                      className="font-display uppercase text-white tracking-wide leading-none"
                      style={{ fontSize: '1.35rem' }}
                    >
                      {f.label}
                    </h3>
                    <p
                      className="font-body mt-1.5"
                      style={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.95rem', lineHeight: 1.5 }}
                    >
                      {f.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column — clickable video preview thumbnail with play
              button overlay. Whole thumbnail is a <button> so it's a
              proper keyboard-accessible target. */}
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setVideoOpen(true)}
              aria-label="Watch Practice:Pace demo video"
              className="relative block w-full overflow-hidden rounded-lg group cursor-pointer"
              style={{ aspectRatio: '16 / 10', border: 0, padding: 0 }}
            >
              <img
                src="/marketing/practice-basketball-3.jpg"
                alt="A basketball team running a practice drill — Practice:Pace demo preview."
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                loading="lazy"
              />
              {/* Subtle dark overlay so the white play button reads on any
                  photo. */}
              <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(0,0,0,0.15)' }} />
              {/* Center play button — white circle with red triangle, semi-
                  transparent white ring around it. */}
              <span
                className="absolute top-1/2 left-1/2 rounded-full bg-white flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                style={{
                  width:     '20%',
                  maxWidth:  120,
                  aspectRatio: '1 / 1',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 0 8px rgba(255,255,255,0.28)',
                }}
              >
                <PlayIcon />
              </span>
            </button>

            <div className="flex flex-col gap-1 mt-2">
              <span
                className="font-display uppercase text-brand-red"
                style={{ fontSize: '0.85rem', letterSpacing: '0.18em' }}
              >
                See It in Action
              </span>
              <p
                className="font-body text-white"
                style={{ fontSize: '0.95rem', lineHeight: 1.5 }}
              >
                Watch how Practice:Pace transforms the way coaches run practice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────── SECTION 4 — TESTIMONIALS ───────────────────── */}
      <section className="bg-black py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-6 flex flex-col items-center gap-3">
          <span
            className="font-display uppercase text-brand-red text-center"
            style={{ fontSize: '0.85rem', letterSpacing: '0.18em' }}
          >
            Coaches Love Practice:Pace
          </span>
          <h2
            className="font-display uppercase text-white text-center leading-none tracking-wide"
            style={{ fontSize: 'clamp(2.25rem, 5.5vw, 3.75rem)' }}
          >
            Trusted by Winners
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-10 w-full">
            {TESTIMONIALS.map(t => (
              <article
                key={t.name}
                className="relative rounded-2xl p-8 flex flex-col gap-4"
                style={{ backgroundColor: '#1a1a1a' }}
              >
                <span
                  className="font-display text-brand-red leading-none"
                  style={{ fontSize: '4.5rem', lineHeight: 0.5, marginBottom: '-8px' }}
                  aria-hidden="true"
                >
                  &ldquo;
                </span>
                <blockquote
                  className="font-body"
                  style={{ color: 'rgba(255,255,255,0.95)', fontSize: '0.95rem', lineHeight: 1.55 }}
                >
                  {t.quote}
                </blockquote>
                <footer className="mt-2">
                  <div
                    className="font-display uppercase text-brand-red tracking-wide"
                    style={{ fontSize: '1.05rem' }}
                  >
                    {t.name}
                  </div>
                  <div
                    className="font-body"
                    style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', marginTop: '2px' }}
                  >
                    {t.program}
                  </div>
                </footer>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ReadyToMaximize />
      <MarketingFooter />

      {/* Video modal — opened from the hero "Watch Demo" button AND from
          the Section 3 play-button thumbnail. Both share the same modal
          instance / same close paths. */}
      <VideoModal open={videoOpen} onClose={() => setVideoOpen(false)} />
    </div>
  )
}
