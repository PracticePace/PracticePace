// ── siteConfig.js ─────────────────────────────────────────────────────────────
// Launch-time switches for the marketing site.

// Demo video. EMPTY = every demo affordance is hidden.
//
// There is no demo video yet. Until this commit the hero "Watch Demo" button,
// the "See It in Action" tile and the CTA band's "Watch Demo" all opened a
// modal that said "Demo video coming soon." — three separate invitations to
// a dead end, on the page whose whole job is to convert. Hiding them is
// honest; a flag means they come back the day a URL exists rather than
// needing the markup rebuilt.
//
// To switch them on: set VITE_DEMO_VIDEO_URL in Vercel and redeploy. Every
// demo surface reads DEMO_VIDEO_ENABLED, so one variable turns all of them on
// together and none of them can be re-enabled by accident on its own.
export const DEMO_VIDEO_URL     = import.meta.env.VITE_DEMO_VIDEO_URL ?? ''
export const DEMO_VIDEO_ENABLED = DEMO_VIDEO_URL.trim().length > 0

// Support inbox, shown on the contact page and used as the fallback whenever
// a send fails.
export const SUPPORT_EMAIL = 'practicepace@gmail.com'

// Where a plan choice is parked while the coach goes off to confirm their
// email. It has to survive a full round-trip through an email client and
// possibly a different tab, so it can't be React state or sessionStorage.
// Read and cleared by Onboarding; written by Login when it sees ?plan=.
export const PENDING_PLAN_KEY = 'pp_pending_plan'
