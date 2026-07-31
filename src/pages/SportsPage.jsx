// PLACEHOLDER — Commit 3 fills in the real Sports page (per-sport
// deep-dive tiles for Football / Basketball / Cheer / Wrestling with
// their solo athlete cutouts + practice-in-action photos) per the
// Boostr mockup. Foundation stub: header + "coming soon" + CTA + footer.

import MarketingHeader  from '../components/marketing/MarketingHeader'
import MarketingFooter  from '../components/marketing/MarketingFooter'
import ReadyToMaximize  from '../components/marketing/ReadyToMaximize'

export default function SportsPage() {
  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh' }}>
      <MarketingHeader />
      <main
        className="flex items-center justify-center px-6 py-24 text-center"
        style={{ minHeight: '50vh' }}
      >
        <div className="flex flex-col items-center gap-4 max-w-2xl">
          <h1
            className="uppercase leading-none"
            style={{
              fontFamily:    'var(--font-display)',
              fontSize:      'clamp(3rem, 8vw, 6rem)',
              letterSpacing: '0.02em',
            }}
          >
            Sports (coming soon)
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', color: '#c8c8c8' }}>
            Per-sport tiles land in Commit 3.
          </p>
        </div>
      </main>
      <ReadyToMaximize />
      <MarketingFooter />
    </div>
  )
}
