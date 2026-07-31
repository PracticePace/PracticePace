// ─────────────────────────────────────────────────────────────────────────────
// MarketingFooter — bottom-of-page footer for the 4 marketing pages.
//
// STUB SCOPE (foundation commit): the four sections from the Boostr
// mockup — Brand block (wordmark + tagline), QUICK LINKS, SPORTS,
// STAY CONNECTED (email input + red SUBSCRIBE button). Email subscribe
// is a plain form that goes nowhere yet — a later commit will wire it
// to whatever mailing-list backend Matt lands on.
// ─────────────────────────────────────────────────────────────────────────────

import { Link } from 'react-router-dom'
import Logo from '../Logo'

const QUICK_LINKS = [
  { to: '/',        label: 'Home'    },
  { to: '/sports',  label: 'Sports'  },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about',   label: 'About'   },
]

// Sports list mirrors the mockup — Football / Basketball / Cheer /
// Wrestling. Each is a marketing landing subroute we'll add in a later
// commit (Commit 3 owns the Sports page). For now they route to the
// generic /sports page.
const SPORTS = [
  { to: '/sports', label: 'Football'    },
  { to: '/sports', label: 'Basketball'  },
  { to: '/sports', label: 'Cheer'       },
  { to: '/sports', label: 'Wrestling'   },
]

// Reusable heading style for the three link-list columns.
const H_STYLE = {
  fontFamily:    'var(--font-display)',
  fontSize:      '1.15rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color:         '#ffffff',
}

const LINK_STYLE = {
  color:      '#c8c8c8',
  fontSize:   '0.9rem',
  fontFamily: 'var(--font-body)',
}

export default function MarketingFooter() {
  function handleSubscribe(e) {
    e.preventDefault()
    // Wire-up placeholder — Commit 5 (Contact page) or later commit
    // hooks this to the real signup endpoint. For now the input is
    // controlled by the browser and this submit is a no-op.
  }

  return (
    <footer
      className="w-full"
      style={{
        backgroundColor: '#000000',
        color:           '#ffffff',
        borderTop:       '1px solid #1a1a1a',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* BRAND */}
          <div className="flex flex-col gap-4">
            <Logo variant="white" height={32} />
            <p style={LINK_STYLE}>
              The #1 practice management system for coaches who demand more.
            </p>
          </div>

          {/* QUICK LINKS */}
          <div className="flex flex-col gap-3">
            <h4 style={H_STYLE}>Quick Links</h4>
            <ul className="flex flex-col gap-2">
              {QUICK_LINKS.map(({ to, label }) => (
                <li key={label}>
                  <Link to={to} className="hover:opacity-80" style={LINK_STYLE}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* SPORTS */}
          <div className="flex flex-col gap-3">
            <h4 style={H_STYLE}>Sports</h4>
            <ul className="flex flex-col gap-2">
              {SPORTS.map(({ to, label }) => (
                <li key={label}>
                  <Link to={to} className="hover:opacity-80" style={LINK_STYLE}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* STAY CONNECTED */}
          <div className="flex flex-col gap-3">
            <h4 style={H_STYLE}>Stay Connected</h4>
            <p style={LINK_STYLE}>Get tips, updates and special offers.</p>
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2 mt-1">
              <input
                type="email"
                name="email"
                placeholder="Your email"
                required
                className="flex-1 outline-none"
                style={{
                  backgroundColor: '#111111',
                  border:          '1px solid #333333',
                  color:           '#ffffff',
                  padding:         '10px 12px',
                  fontFamily:      'var(--font-body)',
                  fontSize:        '0.9rem',
                  borderRadius:    '4px',
                  minWidth:        0,
                }}
              />
              <button
                type="submit"
                className="uppercase transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--color-brand-red)',
                  color:           '#ffffff',
                  fontFamily:      'var(--font-button)',
                  fontSize:        '0.9rem',
                  letterSpacing:   '0.08em',
                  padding:         '10px 16px',
                  borderRadius:    '4px',
                }}
              >
                Subscribe
              </button>
            </form>
          </div>
        </div>

        <div
          className="mt-12 pt-6 flex flex-col md:flex-row justify-between items-center gap-3"
          style={{ borderTop: '1px solid #1a1a1a' }}
        >
          <p style={{ ...LINK_STYLE, color: '#7a7a7a' }}>
            © 2026 Practice:Pace. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <a href="#" className="hover:opacity-80" style={{ ...LINK_STYLE, color: '#7a7a7a' }}>Privacy</a>
            <a href="#" className="hover:opacity-80" style={{ ...LINK_STYLE, color: '#7a7a7a' }}>Terms</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
