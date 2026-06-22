// ─────────────────────────────────────────────────────────────────────────────
// LandingPage — public marketing surface at "/" for signed-out visitors.
// Signed-in users are redirected to /dashboard before this ever mounts
// (see App.jsx).
//
// Structure follows the brief in the spec — sticky header, hero,
// testimonial 1, value props (4-up grid), testimonial 2, screenshot
// gallery (3-4 placeholders), testimonial 3, pricing/CTA, testimonial 4
// (emphasis), footer. Every testimonial and every screenshot is
// PLACEHOLDER content — clearly marked so Matt can swap in the real
// quotes + images without spelunking through the file.
//
// SEO: sets document.title + meta description on mount via useEffect so
// the marketing page gets the right metadata without a Helmet/Helm-async
// dependency. Open Graph tags live in index.html.
//
// Visual style matches the existing app: #080000 page background,
// #cc1111 accent, Bebas Neue for headlines (already loaded globally),
// system sans for body, semantic HTML throughout (<header>, <main>,
// <section>, <footer>).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import Testimonial from '../components/Testimonial'

const ACCENT = '#cc1111'

// Inline SVG icons for the value props grid — matches the codebase
// convention (no lucide-react dep). 32 × 32 stroke icons.
const IconClock = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)
const IconScoreboard = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="8" y1="5" x2="8" y2="19" />
    <line x1="16" y1="5" x2="16" y2="19" />
  </svg>
)
const IconPlay = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
)
const IconUsers = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const IconTwitter = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
const IconInstagram = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
)

// ── Reusable button styles ──────────────────────────────────────────────────
const buttonPrimary = {
  backgroundColor: ACCENT,
  color:           '#ffffff',
  border:          `1px solid ${ACCENT}`,
  boxShadow:       `0 8px 24px ${ACCENT}55`,
}
const buttonSecondary = {
  backgroundColor: 'transparent',
  color:           '#ffffff',
  border:          '1px solid rgba(255,255,255,0.28)',
}

// Gallery tile — real screenshot under public/landing/. Rounded, subtle
// glow + thin border so each tile sits clearly on the dark page bg.
// Image is lazy-loaded since the gallery is below the fold; the hero
// (above the fold) uses loading="eager" instead.
//
// Caption is split into two parts: a bold uppercase lead-in (the
// feature name) and the regular descriptive tail. The lead-in is
// orgColor accent + tracking-widest so the four tiles read as a quick
// at-a-glance scan ("scoreboard / whiteboard / scripts / music") even
// before the eye lands on the descriptions. The previous text-xs
// muted-gray caption was almost invisible against the page background.
function ScreenshotTile({ src, leadIn, caption, alt }) {
  return (
    <figure className="flex flex-col gap-3">
      <img
        src={src}
        alt={alt}
        className="w-full h-auto rounded-2xl block"
        style={{
          backgroundColor: '#0d0000',
          border:          '1px solid #2a0000',
          boxShadow:       `0 16px 40px ${ACCENT}1a, 0 6px 18px rgba(0,0,0,0.55)`,
        }}
        loading="lazy"
        decoding="async"
      />
      <figcaption className="text-center text-sm md:text-base leading-snug" style={{ color: '#e8d8d8' }}>
        <span
          className="font-black uppercase mr-1.5"
          style={{ color: ACCENT, letterSpacing: '0.16em' }}
        >
          {leadIn}
        </span>
        — {caption}
      </figcaption>
    </figure>
  )
}

export default function LandingPage() {
  // SEO. Set title + meta description on mount; restore on unmount so
  // the rest of the app's per-page title-setting (e.g. printable
  // scripts) isn't clobbered later.
  useEffect(() => {
    const prevTitle = document.title
    document.title  = 'Practice:Pace — Coach Better Practices, Run Better Games'
    const metaDesc  = document.querySelector('meta[name="description"]')
    const prevDesc  = metaDesc?.getAttribute('content') ?? null
    if (metaDesc) {
      metaDesc.setAttribute(
        'content',
        'Practice timer, scoreboard, whiteboard, and play library for high school football, basketball, cheer, and more. Built for coaches.'
      )
    }
    return () => {
      document.title = prevTitle
      if (metaDesc && prevDesc != null) metaDesc.setAttribute('content', prevDesc)
    }
  }, [])

  return (
    <div style={{ backgroundColor: '#080000', color: '#ffffff', minHeight: '100vh' }}>

      {/* ── STICKY HEADER ────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4 md:px-8 py-3"
        style={{
          backgroundColor: 'rgba(8,0,0,0.85)',
          backdropFilter:  'blur(8px)',
          borderBottom:    `1px solid ${ACCENT}33`,
        }}
      >
        <Link to="/" aria-label="Practice:Pace home" className="shrink-0">
          <Logo variant="white" height={36} />
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/login"
            className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-opacity hover:opacity-85"
            style={buttonSecondary}
          >
            Log In
          </Link>
          <Link
            to="/login"
            className="px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-opacity hover:opacity-90"
            style={buttonPrimary}
          >
            Get Started
          </Link>
        </nav>
      </header>

      <main>

        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <section className="px-6 pt-12 pb-16 md:pt-20 md:pb-24">
          <div className="max-w-5xl mx-auto flex flex-col items-center text-center gap-6">
            <h1
              style={{
                fontFamily:    "'Bebas Neue', sans-serif",
                fontSize:      'clamp(2.75rem, 7vw, 5.5rem)',
                letterSpacing: '0.02em',
                lineHeight:    1.02,
                textTransform: 'uppercase',
                textShadow:    '0 6px 32px rgba(0,0,0,0.6)',
              }}
            >
              The practice software your team actually uses.
            </h1>
            <p
              className="max-w-2xl text-base md:text-lg leading-relaxed"
              style={{ color: '#d8c8c8' }}
            >
              Time your drills. Run your scoreboard. Mark up your plays.
              Everything coaches need to run better practices and game days
              — in one app.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
              <Link
                to="/login"
                className="px-6 py-3.5 rounded-xl text-base font-bold transition-opacity hover:opacity-90"
                style={buttonPrimary}
              >
                Get Started Free
              </Link>
              <Link
                to="/login"
                className="text-sm font-semibold underline decoration-dotted underline-offset-4 hover:opacity-80"
                style={{ color: '#c8a0a0' }}
              >
                Already have an account? Log in
              </Link>
            </div>

            {/* Hero visual — real screenshot of the practice screen in
                action (Albertville Aggies install). Lives at
                public/landing/hero-practice-screen.png. Width-capped at
                max-w-4xl so it doesn't dominate the page on wide
                viewports; full width on mobile. Subtle red glow + dark
                drop shadow lift it off the page background. */}
            <div className="w-full max-w-4xl mt-8">
              <img
                src="/landing/hero-practice-screen.png"
                alt="Practice:Pace practice screen showing a live drill timer at 4:59 remaining for Albertville Aggies Football, with the next drill 'ALL UP' queued up at 2:30."
                className="w-full h-auto rounded-3xl block"
                style={{
                  boxShadow: `0 30px 80px ${ACCENT}22, 0 10px 30px rgba(0,0,0,0.6)`,
                  border:    '1px solid #2a0000',
                }}
                loading="eager"
                decoding="async"
              />
            </div>
          </div>
        </section>

        {/* ── TESTIMONIAL #1 (hook) ──────────────────────────────────────── */}
        <Testimonial
          quote="Practice:Pace has completely changed how we run our practices. We upload our schedule and it runs directly on our video board, keeping our entire staff and players on the same page without anyone having to watch a clock. This program blows away any other practice software we have seen — if you run a football program and want to maximize every minute of practice, Practice:Pace is a tool you need."
          coachName="Coach Adam Winegarden"
          program="Head Football Coach, Albertville High School"
          orgColor={ACCENT}
        />

        {/* ── VALUE PROPS ────────────────────────────────────────────────── */}
        <section className="px-6 py-16 md:py-24">
          <div className="max-w-5xl mx-auto flex flex-col gap-10">
            <h2
              className="text-center"
              style={{
                fontFamily:    "'Bebas Neue', sans-serif",
                fontSize:      'clamp(2rem, 4.5vw, 3.5rem)',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}
            >
              Built for the way coaches actually work
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {[
                {
                  Icon:  IconClock,
                  title: 'Practice Timer',
                  body:  "Run timed scripts your team can see. Drill notes, music cues, and play diagrams come up automatically.",
                },
                {
                  Icon:  IconScoreboard,
                  title: 'Scoreboards',
                  body:  "Football, basketball, cheer, and more — every scoreboard your team needs. Built for jumbotron display.",
                },
                {
                  Icon:  IconPlay,
                  title: 'Play Library',
                  body:  "Upload your plays once. Pull them up on the whiteboard for chalk talk or drop them into a drill for player reference.",
                },
                {
                  Icon:  IconUsers,
                  title: 'Multi-Program',
                  body:  "Athletic Directors manage every program in the school. Coaches see only what they need.",
                },
              ].map(({ Icon, title, body }) => (
                <article
                  key={title}
                  className="rounded-2xl p-6 flex flex-col gap-3 transition-colors"
                  style={{
                    backgroundColor: '#110404',
                    border:          '1px solid #2a0000',
                  }}
                >
                  <span style={{ color: ACCENT }}><Icon /></span>
                  <h3
                    className="font-bold"
                    style={{
                      fontFamily:    "'Bebas Neue', sans-serif",
                      fontSize:      '1.5rem',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color:         '#ffffff',
                    }}
                  >
                    {title}
                  </h3>
                  <p style={{ color: '#c8b0b0', lineHeight: 1.6, fontSize: '0.95rem' }}>
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── TESTIMONIAL #2 ─────────────────────────────────────────────── */}
        <Testimonial
          quote="Practice:Pace is a complete game changer. We started using it this past Spring and the results were phenomenal. We now have nearly seamless transitions in practice. Everyone is constantly aware of where we are in practice, how much time is remaining in the current period, and what is coming next. I highly recommend this app for any program seriously seeking next level organization."
          coachName="Coach Antonio Ford"
          program="Defensive Coordinator, Albertville High School"
          orgColor={ACCENT}
        />

        {/* ── SCREENSHOT GALLERY ─────────────────────────────────────────── */}
        <section className="px-6 py-16 md:py-24">
          <div className="max-w-5xl mx-auto flex flex-col gap-10">
            <h2
              className="text-center"
              style={{
                fontFamily:    "'Bebas Neue', sans-serif",
                fontSize:      'clamp(2rem, 4.5vw, 3.5rem)',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}
            >
              See it in action
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Real screenshots — see public/landing/ for the source
                  files. Order follows the spec: scoreboard, whiteboard,
                  scripts, music. The practice-screen tile that used to
                  live here was redundant with the hero above (which is
                  already the practice screen), so it was dropped in
                  favour of the music tile. */}
              <ScreenshotTile
                src="/landing/screenshot-scoreboard.png"
                leadIn="Scoreboards"
                caption="Game-day ready, built for jumbotron display"
                alt="Practice:Pace football scoreboard for the Albertville Aggies showing 14-10 home lead, 2nd & 4, ball on the 28, Q2 5:43 on the clock, with the play clock at 19."
              />
              <ScreenshotTile
                src="/landing/screenshot-whiteboard.png"
                leadIn="Whiteboard"
                caption="Draw on your own plays"
                alt="Practice:Pace whiteboard with a football PUNT COVERAGE REGULAR play diagram and route lines drawn in red, blue, and black over an uploaded play image."
              />
              <ScreenshotTile
                src="/landing/screenshot-scripts.png"
                leadIn="Scripts"
                caption="Build once, run all season"
                alt="Practice:Pace script editor showing 'Sample Practice — 90 min' broken into 7 segments (Individual/Position, Group/Unit Period, Team Period, Special Teams, Conditioning, Cool Down, plus one), each with its own duration."
              />
              <ScreenshotTile
                src="/landing/screenshot-music.png"
                leadIn="Music"
                caption="Library, playlists, and drill cues"
                alt="Practice:Pace music tab showing the program's song library with Metallica's Enter Sandman currently playing, plus Sandstorm and Phil Collins' In the Air Tonight queued below."
              />
            </div>
          </div>
        </section>

        {/* ── TESTIMONIAL #3 ─────────────────────────────────────────────── */}
        {/* PLACEHOLDER — restore when real testimonial available. Kept as
            a JSX comment so the slot is easy to find + uncomment later.
        <Testimonial
          quote="Our cheer routines run cleaner since we started using Practice:Pace. The image library means I'm not redrawing pyramids every week."
          coachName="Coach [Last Name]"
          program="[Program] [Sport]"
          orgColor={ACCENT}
        />
        */}

        {/* ── PRICING / CTA ──────────────────────────────────────────────── */}
        <section className="px-6 py-20 md:py-28">
          <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-6">
            <h2
              style={{
                fontFamily:    "'Bebas Neue', sans-serif",
                fontSize:      'clamp(2.25rem, 5vw, 4rem)',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}
            >
              Try it free
            </h2>
            <p className="max-w-xl text-base md:text-lg leading-relaxed" style={{ color: '#d8c8c8' }}>
              No credit card required. Start running better practices today.
            </p>
            <Link
              to="/login"
              className="px-8 py-4 rounded-xl text-lg font-bold transition-opacity hover:opacity-90"
              style={buttonPrimary}
            >
              Get Started Free
            </Link>
            <p className="text-xs mt-2" style={{ color: '#9a8080' }}>
              Questions? Contact us at{' '}
              {/* PLACEHOLDER — Matt to set support address */}
              <span style={{ color: '#c8a0a0' }}>[support email]</span>.
            </p>
          </div>
        </section>

        {/* ── TESTIMONIAL #4 (emphasis closer) ───────────────────────────── */}
        <Testimonial
          quote="PracticePace has been a tremendous addition to how we run practice. I no longer find myself constantly looking down at a paper practice plan — our staff can keep our attention on teaching, correcting, and coaching players. The built-in scoreboard and shot clock have been a huge help, too. No more finding someone to run the clock during practice."
          coachName="Patrick Harding"
          program="Head Basketball Coach, Whitesburg Christian Academy"
          emphasis
          orgColor={ACCENT}
        />
      </main>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer
        className="px-6 py-10"
        style={{
          backgroundColor: '#040000',
          borderTop:       '1px solid #1a0000',
        }}
      >
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-3">
            <Logo variant="white" height={28} />
            <p className="text-xs" style={{ color: '#7a6060' }}>
              © 2026 Practice:Pace. All rights reserved.
            </p>
          </div>

          <nav className="flex items-center gap-5 text-xs" style={{ color: '#c8a0a0' }}>
            {/* PLACEHOLDER hrefs — real /contact, /privacy routes can be
                added later. Plain anchors so they don't 404 in the SPA
                router today. */}
            <a href="#" className="hover:opacity-80">Contact</a>
            <a href="#" className="hover:opacity-80">Privacy</a>
            <a href="#" className="hover:opacity-80">Terms</a>
          </nav>

          <div className="flex items-center gap-3" style={{ color: '#c8a0a0' }}>
            <a href="#" aria-label="Practice:Pace on Twitter / X" className="hover:opacity-80">
              <IconTwitter />
            </a>
            <a href="#" aria-label="Practice:Pace on Instagram" className="hover:opacity-80">
              <IconInstagram />
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
