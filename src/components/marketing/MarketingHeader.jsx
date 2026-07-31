// ─────────────────────────────────────────────────────────────────────────────
// MarketingHeader — sticky top nav for the 4 marketing pages
// (Home, Sports, About, Contact). Reused across every marketing page;
// the individual page components just render <MarketingHeader /> at the
// top of their <main>.
//
// STUB SCOPE (foundation commit): logo left, four nav links center-right,
// red "GET STARTED" button on the far right. Real polish (mobile menu,
// active-link highlight, translucent-on-scroll, etc.) is a later commit
// once the full page designs are in.
// ─────────────────────────────────────────────────────────────────────────────

import { Link, NavLink } from 'react-router-dom'
import Logo from '../Logo'

const NAV = [
  { to: '/sports',  label: 'Sports'  },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about',   label: 'About'   },
  { to: '/contact', label: 'Contact' },
]

export default function MarketingHeader() {
  return (
    <header
      className="sticky top-0 z-40 w-full"
      style={{
        backgroundColor: 'rgba(0,0,0,0.92)',
        backdropFilter:  'blur(8px)',
        borderBottom:    '1px solid #1a1a1a',
      }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 md:px-6 py-3">
        {/* Logo — routes to /, which the RootRoute either shows HomePage
            for (signed-out) or redirects to /dashboard for (signed-in). */}
        <Link to="/" aria-label="Practice:Pace home" className="shrink-0">
          <Logo variant="white" height={32} />
        </Link>

        {/* Center nav — hidden on small screens (mobile menu is a later
            commit). font-display is the Tailwind alias set in index.css
            for Bebas Neue. */}
        <nav
          className="hidden md:flex items-center gap-8 font-display uppercase"
          style={{ letterSpacing: '0.08em', fontSize: '1rem' }}
        >
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `transition-opacity hover:opacity-80 ${isActive ? 'opacity-100' : 'opacity-80'}`
              }
              style={({ isActive }) => ({
                color:              '#ffffff',
                borderBottom:       isActive ? '2px solid var(--color-brand-red)' : '2px solid transparent',
                paddingBottom:      '4px',
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* GET STARTED — routes to the app's Login page for now (which
            is also the account-create surface via its inline mode
            toggle). Uses font-button (Barlow Condensed 700). */}
        <Link
          to="/login"
          className="shrink-0 font-button uppercase text-white transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--color-brand-red)',
            padding:         '10px 20px',
            fontSize:        '0.95rem',
            letterSpacing:   '0.08em',
            borderRadius:    '4px',
          }}
        >
          Get Started
        </Link>
      </div>
    </header>
  )
}
