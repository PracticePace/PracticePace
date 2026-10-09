// ─────────────────────────────────────────────────────────────────────────────
// LegalLayout — shared chrome and typography for /terms and /privacy.
//
// Uses the same MarketingHeader / MarketingFooter and the same type scale as
// the other marketing pages (font-display Bebas headings, font-body Inter
// copy, black ground), but with a narrower measure — legal prose is read, not
// scanned, and 70-ish characters per line is the point where it stops being a
// wall. Contained to max-w-3xl, matching the About page's mission section.
//
// The <Section> and <P> helpers exist so the two documents can't drift apart
// in spacing or heading weight. Both pages are plain content: no state, no
// effects, no data loading.
// ─────────────────────────────────────────────────────────────────────────────

import MarketingHeader from './MarketingHeader'
import MarketingFooter from './MarketingFooter'

// Every legal change needs a visible date. Both pages pass the same one.
export function LastUpdated({ date }) {
  return (
    <p
      className="font-body"
      style={{ color: '#7a7a7a', fontSize: '0.9rem', letterSpacing: '0.02em' }}
    >
      Last updated: {date}
    </p>
  )
}

// A numbered top-level clause.
export function Section({ n, title, children }) {
  return (
    <section className="flex flex-col gap-3">
      <h2
        className="font-display uppercase text-white leading-tight tracking-wide"
        style={{ fontSize: 'clamp(1.35rem, 2.6vw, 1.75rem)' }}
      >
        {n}. {title}
      </h2>
      {children}
    </section>
  )
}

export function P({ children }) {
  return (
    <p
      className="font-body"
      style={{ color: '#d4d4d4', fontSize: '1rem', lineHeight: 1.7 }}
    >
      {children}
    </p>
  )
}

export function List({ children }) {
  return (
    <ul className="flex flex-col gap-2 pl-1">
      {children}
    </ul>
  )
}

export function LI({ children }) {
  return (
    <li
      className="font-body flex items-start gap-3"
      style={{ color: '#d4d4d4', fontSize: '1rem', lineHeight: 1.7 }}
    >
      <span aria-hidden="true" style={{ color: 'var(--color-brand-red)', marginTop: '0.1rem' }}>—</span>
      <span>{children}</span>
    </li>
  )
}

export default function LegalLayout({ eyebrow, title, intro, children }) {
  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh' }}>
      <MarketingHeader />

      <main>
        {/* Title block — no hero photo. A photograph over a terms page
            reads as marketing dressed up as a contract. */}
        <section className="pt-14 pb-8 md:pt-20 md:pb-10" style={{ borderBottom: '1px solid #1a1a1a' }}>
          <div className="max-w-3xl mx-auto px-6 flex flex-col gap-4">
            <span
              className="font-display uppercase text-brand-red"
              style={{ fontSize: '0.85rem', letterSpacing: '0.18em' }}
            >
              {eyebrow}
            </span>
            <h1
              className="font-display uppercase text-white leading-none tracking-wide"
              style={{ fontSize: 'clamp(2.5rem, 7vw, 4.5rem)' }}
            >
              {title}
            </h1>
            {intro}
          </div>
        </section>

        <section className="py-10 md:py-14">
          <div className="max-w-3xl mx-auto px-6 flex flex-col gap-9">
            {children}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
