import { useState, useEffect } from 'react'
import Logo from './Logo'

// ── LandscapeOnly ─────────────────────────────────────────────────────────────
// Practice:Pace is a landscape iPad app by product decision. Held upright, the
// layout just looks broken and a coach reasonably concludes the app is buggy.
// This puts an honest message over the top instead.
//
// WRAPS ONLY THE APP SCREENS — dashboard, script, scoreboard, display,
// onboarding, admin. The marketing pages and the login / invite / reset screens
// are responsive and read fine upright, and telling someone to rotate before
// they can even sign in would be worse than the problem.
//
// HOW THE DESKTOP LINE IS DRAWN
// Three conditions, all required:
//   1. navigator.maxTouchPoints > 0 — a real touch device. This is what keeps a
//      narrow desktop window out: a browser dragged tall and thin still reports
//      0 touch points, so it never sees this no matter how it is sized. It also
//      catches iPadOS correctly, which reports itself as a Mac in the user
//      agent but always reports 5 touch points.
//   2. height > width — the actual measurement, taken from the viewport rather
//      than the deprecated window.orientation.
//   3. width <= 1024 — every iPad upright is at most 1024 points wide (iPad Pro
//      12.9"); mini is 744, Air 820, Pro 11" 834. This is a sanity bound so a
//      touchscreen desktop monitor pivoted upright doesn't trip it.
//
// The timers are untouched on purpose. practiceTimer and scoreboardStore both
// live in module scope and tick independently of what is rendered, so a coach
// who bumps the iPad sideways mid-drill keeps their game clock — this only
// draws over the top, it never pauses or resets anything.

const MAX_UPRIGHT_WIDTH = 1024

function isPortraitTouchDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!(navigator.maxTouchPoints > 0)) return false
  return window.innerHeight > window.innerWidth
      && window.innerWidth <= MAX_UPRIGHT_WIDTH
}

export default function LandscapeOnly({ children }) {
  const [upright, setUpright] = useState(isPortraitTouchDevice)

  useEffect(() => {
    const recheck = () => setUpright(isPortraitTouchDevice())

    // Three triggers, deliberately redundant. Rotation normally fires `resize`
    // on iPadOS, but this could not be tested on real hardware, and a message
    // that fails to clear when the coach rotates back would be worse than never
    // showing it at all. The media query is dimension-derived (not the
    // deprecated window.orientation) and fires reliably on its own.
    const mq = window.matchMedia?.('(orientation: portrait)')
    window.addEventListener('resize', recheck)
    window.visualViewport?.addEventListener('resize', recheck)
    mq?.addEventListener?.('change', recheck)

    recheck()
    return () => {
      window.removeEventListener('resize', recheck)
      window.visualViewport?.removeEventListener('resize', recheck)
      mq?.removeEventListener?.('change', recheck)
    }
  }, [])

  return (
    <>
      {children}
      {upright && (
        // Opaque and above everything (the app's own layers top out at z-50, and
        // modals sit there too), so nothing behind shows through.
        <div
          role="alertdialog"
          aria-label="Turn your iPad sideways"
          className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-8 text-center"
          style={{ backgroundColor: '#0d0000', zIndex: 9999 }}
        >
          <Logo variant="white" height={44} />

          {/* Rotating-tablet mark. Deliberately simple — it reads at a glance
              from arm's length, which is how it will be seen. */}
          <svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="#cc1111"
               strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="8" y="2" width="8" height="20" rx="1.6" />
            <path d="M3.5 9a9 9 0 0 1 3.2-4.6" />
            <polyline points="2 5.5 3.4 9.2 7 7.8" />
            <path d="M20.5 15a9 9 0 0 1-3.2 4.6" />
            <polyline points="22 18.5 20.6 14.8 17 16.2" />
          </svg>

          <h1
            className="font-black tracking-widest uppercase"
            style={{
              fontFamily:    "'Bebas Neue', sans-serif",
              fontSize:      'clamp(1.8rem, 7vw, 2.6rem)',
              color:         '#ffffff',
              letterSpacing: '0.1em',
              lineHeight:    1.05,
            }}
          >
            Turn your iPad sideways
          </h1>

          <p className="text-base leading-relaxed max-w-sm" style={{ color: '#c8a0a0' }}>
            Practice:Pace is built for landscape.
          </p>
          <p className="text-sm leading-relaxed max-w-sm" style={{ color: '#9a8080' }}>
            Your practice and clocks keep running — rotate back and you&rsquo;ll pick up
            right where you left off.
          </p>
        </div>
      )}
    </>
  )
}
