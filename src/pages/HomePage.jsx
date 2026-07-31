// PLACEHOLDER — Commit 2 fills in the real Home page (hero, feature
// cards, screenshot gallery, testimonials, etc.) per the Boostr
// mockup. This foundation commit stands up the skeleton so the route
// resolves and the shared MarketingHeader / MarketingFooter /
// ReadyToMaximize wrap-around is already in place.

import MarketingHeader  from '../components/marketing/MarketingHeader'
import MarketingFooter  from '../components/marketing/MarketingFooter'
import ReadyToMaximize  from '../components/marketing/ReadyToMaximize'

export default function HomePage() {
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
            Home (coming soon)
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize:   '1rem',
              color:      '#c8c8c8',
            }}
          >
            The new Boostr-designed home page lands in the next commit.
            Header, CTA block, and footer below are already in place.
          </p>
        </div>
      </main>
      <ReadyToMaximize />
      <MarketingFooter />
    </div>
  )
}
