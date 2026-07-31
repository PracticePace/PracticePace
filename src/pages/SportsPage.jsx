// Sports page — /sports (Boostr rebuild Commit 3).
//
// Structure (top-to-bottom):
//   • MarketingHeader
//   • Hero — 4-column solo-athlete strip with overlaid "SPORTS"
//     headline (desktop); stacked SPORTS bar + 2×2 image grid (mobile)
//   • Headline block — red eyebrow + "MAXIMIZE EVERY MINUTE"
//   • 4 sport cards — Football / Basketball / Cheer / Wrestling, each
//     with a scene photo + name + feature list
//   • ReadyToMaximize
//   • MarketingFooter
//
// Header / CTA / Footer rendered inline (Commit 1 per-page pattern —
// no Outlet layout in the repo). Same convention as HomePage.

import MarketingHeader  from '../components/marketing/MarketingHeader'
import MarketingFooter  from '../components/marketing/MarketingFooter'
import ReadyToMaximize  from '../components/marketing/ReadyToMaximize'

// ── Data ───────────────────────────────────────────────────────────────────
// Hero portraits — the 4 solo athlete cutouts (transparent-BG PNGs
// composited on the black hero background).
const HERO_SOLOS = [
  { key: 'football',   src: '/marketing/football-solo.png',   alt: 'Solo portrait of a football player.' },
  { key: 'basketball', src: '/marketing/basketball-solo.png', alt: 'Solo portrait of a basketball player.' },
  { key: 'cheer',      src: '/marketing/cheer-solo.png',      alt: 'Solo portrait of a cheerleader.' },
  { key: 'wrestling',  src: '/marketing/wrestling-solo.png',  alt: 'Solo portrait of a wrestler.' },
]

// Card content — scene photos (NOT solos) + verbatim feature copy per
// spec. Feature names are marketing copy from the Boostr mockup and
// may not 1:1 map to real app feature names.
const SPORT_CARDS = [
  {
    key:      'football',
    image:    '/marketing/practice-football-3.jpg',
    alt:      'Football players in a practice drill.',
    name:     'Football',
    features: ['Practice Planning', 'Period Management', 'Live Scoreboard', 'Performance Clock'],
  },
  {
    key:      'basketball',
    image:    '/marketing/practice-basketball-2.jpg',
    alt:      'Basketball players running a practice drill on the court.',
    name:     'Basketball',
    features: ['Practice Planning', 'Shot Clock', 'Scoring & Stats', 'Next Up'],
  },
  {
    key:      'cheer',
    image:    '/marketing/practice-cheer-2.jpg',
    alt:      'Cheerleaders running a routine during practice.',
    name:     'Cheer',
    features: ['Routine & Drill Planning', 'Time Tracking', 'Music & Audio Cues', 'Performance Clock'],
  },
  {
    key:      'wrestling',
    image:    '/marketing/practice-wrestling-2.jpg',
    alt:      'Wrestlers drilling on the mat during practice.',
    name:     'Wrestling',
    features: ['Practice Planning', 'Drill Library', 'Live Scoreboard', 'Performance Clock'],
  },
]

export default function SportsPage() {
  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh' }}>
      <MarketingHeader />

      {/* ───────────── SECTION 1 — 4-SPORT HERO STRIP ───────────── */}
      <section className="relative bg-black overflow-hidden">
        {/* Mobile layout: SPORTS bar (30vh) above a 2×2 image grid.
            Hidden on lg+ where the desktop version takes over. */}
        <div className="lg:hidden">
          <div
            className="flex items-center justify-center px-6"
            style={{ minHeight: '25vh', backgroundColor: '#000' }}
          >
            <h1
              className="font-display uppercase text-white leading-none tracking-wide"
              style={{ fontSize: 'clamp(4rem, 22vw, 8rem)' }}
            >
              Sports
            </h1>
          </div>
          <div className="grid grid-cols-2 gap-0" style={{ minHeight: '60vh' }}>
            {HERO_SOLOS.map(s => (
              <div key={s.key} className="relative overflow-hidden" style={{ minHeight: '30vh' }}>
                <img
                  src={s.src}
                  alt={s.alt}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="async"
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Desktop layout: 4 full-height columns with overlaid centered
            SPORTS text. Hidden on mobile via `hidden lg:block`. */}
        <div className="hidden lg:block relative" style={{ minHeight: '85vh' }}>
          <div className="absolute inset-0 grid grid-cols-4">
            {HERO_SOLOS.map(s => (
              <div key={s.key} className="relative overflow-hidden">
                <img
                  src={s.src}
                  alt={s.alt}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="async"
                />
              </div>
            ))}
          </div>
          {/* Dark gradient overlay on the whole strip so the SPORTS
              text has contrast against any bright pixels in the
              cutouts. */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
          />
          {/* Overlaid centered SPORTS headline. Sized so it dominates
              without overflowing at typical desktop widths. */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <h1
              className="font-display uppercase text-white leading-none tracking-wide text-center"
              style={{
                fontSize:   'clamp(6rem, 18vw, 16rem)',
                textShadow: '0 8px 40px rgba(0,0,0,0.55)',
              }}
            >
              Sports
            </h1>
          </div>
        </div>
      </section>

      {/* ───────────── SECTION 2 — HEADLINE BLOCK ───────────── */}
      <section className="bg-black py-16 md:py-24">
        <div className="max-w-5xl mx-auto px-6 flex flex-col items-center text-center gap-4">
          <span
            className="font-display uppercase text-brand-red"
            style={{ fontSize: '0.9rem', letterSpacing: '0.18em' }}
          >
            Four Sports. One Standard.
          </span>
          <h2
            className="font-display uppercase text-white leading-none tracking-wide"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)' }}
          >
            Maximize Every Minute
          </h2>
        </div>
      </section>

      {/* ───────────── SECTION 3 — 4 SPORT FEATURE CARDS ───────────── */}
      <section className="bg-black pb-16 md:pb-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {SPORT_CARDS.map(card => (
              <article
                key={card.key}
                className="rounded-lg overflow-hidden flex flex-col transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl"
                style={{
                  backgroundColor: '#0a0a0a',
                  border:          '1px solid #1a1a1a',
                }}
              >
                {/* Photo — 3:4 portrait aspect, cover-fit. */}
                <div className="relative overflow-hidden" style={{ aspectRatio: '3 / 4' }}>
                  <img
                    src={card.image}
                    alt={card.alt}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  {/* Bottom gradient so any future overlaid text on the
                      photo would remain legible; harmless here where
                      the sport name lives BELOW the photo. */}
                  <div
                    className="absolute inset-x-0 bottom-0 pointer-events-none"
                    style={{
                      height:     '35%',
                      background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                    }}
                  />
                </div>

                {/* Text block — sport name, features label, list. */}
                <div className="flex flex-col gap-4 p-6 lg:p-7 flex-1">
                  <h3
                    className="font-display uppercase text-brand-red leading-none tracking-wide"
                    style={{ fontSize: 'clamp(1.9rem, 2.6vw, 2.3rem)' }}
                  >
                    {card.name}
                  </h3>
                  <div className="flex flex-col gap-2">
                    <span
                      className="font-display uppercase"
                      style={{
                        color:         'rgba(255,255,255,0.5)',
                        fontSize:      '0.7rem',
                        letterSpacing: '0.2em',
                      }}
                    >
                      Features
                    </span>
                    <ul className="flex flex-col gap-2">
                      {card.features.map(f => (
                        <li
                          key={f}
                          className="flex items-center gap-2.5 font-body"
                          style={{
                            color:      'rgba(255,255,255,0.9)',
                            fontSize:   '0.9rem',
                            lineHeight: 1.35,
                          }}
                        >
                          {/* Small brand-red bullet — inline SVG check
                              mark for a crisper edge than a plain dot
                              at small sizes. */}
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--color-brand-red)"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="shrink-0"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span className="uppercase" style={{ letterSpacing: '0.03em' }}>
                            {f}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <ReadyToMaximize />
      <MarketingFooter />
    </div>
  )
}
