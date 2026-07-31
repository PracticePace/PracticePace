// About page — /about (Boostr rebuild Commit 4).
//
// Structure (top-to-bottom):
//   • MarketingHeader
//   • Hero — full-bleed wrestling scene photo with dark overlay and
//     centered ABOUT headline
//   • Mission — left-aligned red eyebrow + PRACTICE:PACE headline +
//     two body paragraphs, contained to ~800 px
//   • Three value blocks — TIME MATTERS / BUILT FOR COACHES /
//     RESULTS FOCUSED, each with an inline red SVG icon + red Bebas
//     headline + Inter body
//   • ReadyToMaximize
//   • MarketingFooter
//
// Header / CTA / Footer inline per Commits 1-3 pattern.

import MarketingHeader  from '../components/marketing/MarketingHeader'
import MarketingFooter  from '../components/marketing/MarketingFooter'
import ReadyToMaximize  from '../components/marketing/ReadyToMaximize'

// ── Inline SVG icons ────────────────────────────────────────────────────────
// Continuing Commit 2's pattern of inline stroke-based SVGs at
// currentColor so the caller controls tint. Whistle drawn as a
// pea-whistle silhouette (round chamber + tapered mouthpiece + top
// hanger loop) — approximates the coach-whistle mockup icon closely
// enough at this size.
const ClockIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

const WhistleIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    {/* Round pea-whistle chamber */}
    <circle cx="9" cy="14" r="5" />
    {/* Tapered mouthpiece extending up-right from the chamber */}
    <path d="M13 11 L20 4" />
    {/* Small hanger loop at the mouthpiece tip */}
    <circle cx="20" cy="4" r="1.4" />
    {/* Air vent slot on the chamber */}
    <line x1="6" y1="14" x2="8" y2="14" />
  </svg>
)

const TrophyIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">
    {/* Cup body */}
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
    {/* Left handle */}
    <path d="M8 6H5a2 2 0 0 0 0 4h3" />
    {/* Right handle */}
    <path d="M16 6h3a2 2 0 0 1 0 4h-3" />
    {/* Stem */}
    <path d="M12 13v4" />
    {/* Base */}
    <path d="M8 20h8" />
    <path d="M10 17h4v3h-4z" />
  </svg>
)

const VALUES = [
  {
    key:      'time',
    Icon:     ClockIcon,
    title:    'Time Matters',
    body:     'We help coaches make the most of every second of practice.',
  },
  {
    key:      'coaches',
    Icon:     WhistleIcon,
    title:    'Built for Coaches',
    body:     "Run by coaches for coaches — because we've been on your sideline.",
  },
  {
    key:      'results',
    Icon:     TrophyIcon,
    title:    'Results Focused',
    body:     "Better practices build better teams. That's what drives everything we do.",
  },
]

export default function AboutPage() {
  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh' }}>
      <MarketingHeader />

      {/* ───────────── SECTION 1 — HERO ───────────── */}
      <section
        className="relative flex items-center justify-center overflow-hidden"
        style={{ minHeight: 'min(80vh, 900px)' }}
      >
        <img
          src="/marketing/practice-wrestling-3.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
          decoding="async"
          aria-hidden="true"
        />
        {/* Dark overlay — 0.6 alpha so the image reads as atmospheric
            underlay but ABOUT dominates. */}
        <div
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          aria-hidden="true"
        />
        <h1
          className="relative font-display uppercase text-white leading-none tracking-wide text-center px-6"
          style={{
            fontSize:   'clamp(4.5rem, 15vw, 12rem)',
            textShadow: '0 8px 40px rgba(0,0,0,0.55)',
          }}
        >
          About
        </h1>
      </section>

      {/* ───────────── SECTION 2 — MISSION STATEMENT ───────────── */}
      <section className="bg-black py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-6 flex flex-col gap-6 items-start text-left">
          <span
            className="font-display uppercase text-brand-red"
            style={{ fontSize: '0.85rem', letterSpacing: '0.18em' }}
          >
            About
          </span>
          <h2
            className="font-display uppercase text-white leading-none tracking-wide"
            style={{ fontSize: 'clamp(2.5rem, 6.5vw, 4.5rem)' }}
          >
            Practice:Pace
          </h2>
          <p
            className="font-body text-white mt-2"
            style={{ fontSize: 'clamp(1rem, 1.4vw, 1.15rem)', lineHeight: 1.65 }}
          >
            Practice:Pace was built by coaches who know that better practice
            means better results.
          </p>
          <p
            className="font-body text-white"
            style={{ fontSize: 'clamp(1rem, 1.4vw, 1.15rem)', lineHeight: 1.65 }}
          >
            Our mission is simple: help coaches take control of their time,
            communicate with clarity, and maximize every minute that matters.
          </p>
        </div>
      </section>

      {/* ───────────── SECTION 3 — THREE VALUE BLOCKS ───────────── */}
      <section className="bg-black pb-16 md:pb-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {VALUES.map(v => {
              const Icon = v.Icon
              return (
                <article
                  key={v.key}
                  className="rounded-lg p-6 md:p-8 flex flex-col gap-4"
                  style={{
                    backgroundColor: 'transparent',
                    // Subtle white/10 border — dark enough to read as a
                    // container edge without competing with the red
                    // headline inside.
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <div className="text-brand-red">
                    <Icon />
                  </div>
                  <h3
                    className="font-display uppercase text-brand-red leading-none tracking-wide"
                    style={{ fontSize: 'clamp(1.75rem, 2.4vw, 2.1rem)' }}
                  >
                    {v.title}
                  </h3>
                  <p
                    className="font-body text-white"
                    style={{ fontSize: '1rem', lineHeight: 1.6 }}
                  >
                    {v.body}
                  </p>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <ReadyToMaximize />
      <MarketingFooter />
    </div>
  )
}
