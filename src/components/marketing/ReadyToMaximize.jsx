// ─────────────────────────────────────────────────────────────────────────────
// ReadyToMaximize — recurring bottom-of-page CTA block, dropped in above
// the footer on each of the 4 marketing pages. Full-bleed red gradient
// section per the Boostr mockup:
//   "READY TO MAXIMIZE EVERY MINUTE?"
//   "Join coaches across the country who are running smarter practices
//    and building champions."
//   [GET STARTED (filled red — wait, on red bg → white filled instead)]
//   [WATCH DEMO (outline)]
//
// STUB SCOPE: content in place, layout responsive, buttons wired
// (GET STARTED → /login, WATCH DEMO → # for now — later commit routes
// to a real demo video or embedded player).
// ─────────────────────────────────────────────────────────────────────────────

import { Link } from 'react-router-dom'

export default function ReadyToMaximize() {
  return (
    <section
      className="w-full"
      style={{
        // Full-bleed red gradient — solid brand red with a subtle darker
        // vignette at the edges so the block reads as its own moment on
        // the page rather than a flat color band.
        background: 'radial-gradient(ellipse at center, var(--color-brand-red) 0%, #a01418 100%)',
        color:      '#ffffff',
      }}
    >
      <div className="max-w-5xl mx-auto px-6 py-20 md:py-28 flex flex-col items-center text-center gap-6">
        <h2
          className="uppercase leading-none"
          style={{
            fontFamily:    'var(--font-display)',
            fontSize:      'clamp(3rem, 8vw, 6rem)',
            letterSpacing: '0.02em',
            textShadow:    '0 4px 24px rgba(0,0,0,0.35)',
          }}
        >
          Ready to Maximize Every Minute?
        </h2>

        <p
          className="max-w-2xl"
          style={{
            fontFamily: 'var(--font-body)',
            fontSize:   'clamp(1rem, 1.5vw, 1.2rem)',
            lineHeight: 1.6,
            color:      'rgba(255,255,255,0.94)',
          }}
        >
          Join coaches across the country who are running smarter practices
          and building champions.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
          {/* GET STARTED — inverted on the red bg: white fill, red text. */}
          <Link
            to="/login"
            className="uppercase transition-opacity hover:opacity-90"
            style={{
              backgroundColor: '#ffffff',
              color:           'var(--color-brand-red)',
              fontFamily:      'var(--font-button)',
              fontSize:        '1rem',
              letterSpacing:   '0.08em',
              padding:         '14px 26px',
              borderRadius:    '4px',
              boxShadow:       '0 8px 24px rgba(0,0,0,0.28)',
            }}
          >
            Get Started
          </Link>
          {/* WATCH DEMO — outline. Routes to nothing yet (# href) — a
              later commit wires this to a real demo video or embedded
              player. */}
          <a
            href="#"
            className="uppercase transition-opacity hover:opacity-85"
            style={{
              backgroundColor: 'transparent',
              color:           '#ffffff',
              fontFamily:      'var(--font-button)',
              fontSize:        '1rem',
              letterSpacing:   '0.08em',
              padding:         '13px 26px',
              border:          '2px solid #ffffff',
              borderRadius:    '4px',
            }}
          >
            Watch Demo
          </a>
        </div>
      </div>
    </section>
  )
}
