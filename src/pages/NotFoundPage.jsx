// 404 — catch-all for unknown routes.
//
// vercel.json rewrites every path to index.html so the SPA router can handle
// it, which means a typo'd or dead URL reached <Routes> and matched nothing.
// React Router renders nothing for no match, so the result was a bare black
// page: no header, no message, no way out. Indistinguishable from the app
// being broken.
//
// Uses the marketing chrome so the header nav alone is already an exit, with
// explicit Home and Pricing buttons for the two destinations most people
// landing here actually want.

import { Link } from 'react-router-dom'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import { SUPPORT_EMAIL } from '../lib/siteConfig'

export default function NotFoundPage() {
  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh' }}
         className="flex flex-col">
      <MarketingHeader />

      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-xl flex flex-col items-center text-center gap-5">
          <span
            className="font-display uppercase text-brand-red"
            style={{ fontSize: '0.85rem', letterSpacing: '0.18em' }}
          >
            Error 404
          </span>

          <h1
            className="font-display uppercase text-white leading-none tracking-wide"
            style={{ fontSize: 'clamp(3.5rem, 12vw, 7rem)' }}
          >
            Off Sides
          </h1>

          <p
            className="font-body"
            style={{ color: '#d4d4d4', fontSize: '1.05rem', lineHeight: 1.65 }}
          >
            This page doesn&rsquo;t exist. It may have moved, or the link that
            brought you here may be out of date.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 mt-3">
            <Link
              to="/"
              className="font-button uppercase text-white text-center transition-opacity hover:opacity-90"
              style={{
                backgroundColor: 'var(--color-brand-red)',
                padding:         '14px 28px',
                letterSpacing:   '0.08em',
                borderRadius:    '4px',
                fontSize:        '1rem',
                minWidth:        '180px',
              }}
            >
              Home
            </Link>
            <Link
              to="/pricing"
              className="font-button uppercase text-white text-center transition-opacity hover:opacity-90"
              style={{
                backgroundColor: 'transparent',
                border:          '2px solid var(--color-brand-red)',
                padding:         '12px 28px',
                letterSpacing:   '0.08em',
                borderRadius:    '4px',
                fontSize:        '1rem',
                minWidth:        '180px',
              }}
            >
              Pricing
            </Link>
          </div>

          <p className="font-body mt-4" style={{ color: '#7a7a7a', fontSize: '0.9rem' }}>
            Think this is a mistake?{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-brand-red"
              style={{ textDecoration: 'underline' }}
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </main>

      <MarketingFooter />
    </div>
  )
}
