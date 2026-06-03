// ─────────────────────────────────────────────────────────────────────────────
// Testimonial — reusable pull-quote block for the landing page.
//
// Used four times between the hero / value props / screenshots / pricing
// sections. The standard variant is a centered quote with a colored
// accent line above; the `emphasis` variant (used for the final
// testimonial before the footer) bumps the type size and adds a
// gradient background so it carries more visual weight as the closer.
//
// PROPS
//   quote      — string. The pull quote, sans quotation marks (we add a
//                large decorative " glyph above).
//   coachName  — string. Display under the quote.
//   program    — string. Subtitle under the coach name.
//   emphasis   — bool. Slightly larger + tinted background.
//   orgColor   — string. Accent for the top rule + glyph.
// ─────────────────────────────────────────────────────────────────────────────

export default function Testimonial({
  quote,
  coachName,
  program,
  emphasis = false,
  orgColor = '#cc1111',
}) {
  return (
    <section
      className="px-6 py-16 md:py-24"
      style={{
        // Testimonials sit on a slightly lighter tone than the main page
        // (#080000) so they read as distinct breaks between content
        // sections. Emphasis variant gets a subtle radial wash from the
        // accent for extra weight on the final testimonial.
        backgroundColor: emphasis ? '#140404' : '#0d0202',
        backgroundImage: emphasis
          ? `radial-gradient(ellipse at center, ${orgColor}11 0%, transparent 70%)`
          : undefined,
        borderTop:    '1px solid #1a0000',
        borderBottom: '1px solid #1a0000',
      }}
    >
      <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-6">
        {/* Decorative quote glyph + accent rule */}
        <div className="flex flex-col items-center gap-3">
          <span
            aria-hidden="true"
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize:   emphasis ? '5rem' : '4rem',
              lineHeight: 0.6,
              color:      orgColor,
            }}
          >
            &ldquo;
          </span>
          <span
            aria-hidden="true"
            style={{
              display:         'block',
              width:           48,
              height:          3,
              backgroundColor: orgColor,
              borderRadius:    2,
            }}
          />
        </div>

        <blockquote
          className="leading-snug"
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize:   emphasis
              ? 'clamp(1.75rem, 4vw, 3rem)'
              : 'clamp(1.5rem, 3vw, 2.25rem)',
            color:         'rgba(255,255,255,0.96)',
            letterSpacing: '0.02em',
            textShadow:    '0 2px 12px rgba(0,0,0,0.6)',
          }}
        >
          {quote}
        </blockquote>

        <footer className="flex flex-col items-center gap-1">
          <cite
            className="not-italic font-bold"
            style={{
              fontSize:      emphasis ? '1.1rem' : '1rem',
              color:         '#e8d8d8',
              letterSpacing: '0.04em',
            }}
          >
            — {coachName}
          </cite>
          <span
            className="text-xs uppercase tracking-widest"
            style={{ color: '#9a8080', letterSpacing: '0.18em' }}
          >
            {program}
          </span>
        </footer>
      </div>
    </section>
  )
}
