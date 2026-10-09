// ── plans.js ──────────────────────────────────────────────────────────────────
// THE single source of truth for what we sell. Both pricing surfaces read from
// here — the public landing page (src/pages/Pricing.jsx) and the in-app
// paywall / upgrade modal (src/components/dashboard/PlanSelectModal.jsx) —
// along with the plan label in Settings.
//
// WHY ONE FILE
// Before this, the landing page held its prices as numbers (79 / 749 / 199 /
// 1872) and the in-app modal held them AGAIN as hardcoded display strings
// ('$79', '$749', '$199', '$1,872'), with neither reading anything from
// Stripe. Nothing stopped the two from disagreeing, and nothing stopped either
// from disagreeing with the Stripe price that would actually be charged. Any
// price change now happens here, once.
//
// WHAT IS DELIBERATELY *NOT* HERE: Stripe price IDs.
// The client sends a PLAN KEY ('individual' | 'school') to
// /api/stripe-checkout and the server maps that key to a price ID from its own
// environment (api/_lib/entitlements.js). A price ID in the browser bundle is
// a value the caller can substitute — swap in the cheap price, get the
// expensive entitlement. Keys are a closed set the server validates, so the
// worst a tampered request can do is name the other published plan.
//
// KEYS ARE A CONTRACT in three places and must match exactly:
//   • PLAN_KEYS here
//   • PLAN_ENV_VARS in api/_lib/entitlements.js
//   • the accounts.plan_tier CHECK constraint (migration 20261009000000)
// The CHECK constraint is the backstop: a key that drifts can't be written.

// Both plans are billed annually. There is no monthly option — the old
// monthly/annual matrix (4 prices, 2 toggles, 2 "Save 20%" badges) is gone.
export const PLAN_KEYS = ['individual', 'school']

export const PLANS = {
  individual: {
    key:       'individual',
    name:      'Individual',
    // Shown under the plan name. Kept to one line on purpose — these render
    // inside a 2-up card grid at tablet width.
    tagline:   'One program, one head coach.',
    price:     699,
    priceText: '$699',
    period:    '/yr',
    // The one-line summary the brief specified, used wherever there is only
    // room for a single sentence (paywall subtitle, upgrade copy).
    summary:   'One program',
    billedBy:  'Head Coach is the billing owner.',
    features: [
      'One program',
      'Unlimited practice scripts',
      'Live practice timer with air horn',
      'Scoreboard + stage display',
      'Music player and video library',
      'Unlimited coaches on that program',
      'iPad and desktop ready',
    ],
    highlight: false,
  },
  school: {
    key:       'school',
    name:      'School-Wide',
    tagline:   'Every program in your school.',
    price:     1199,
    priceText: '$1,199',
    period:    '/yr',
    summary:   'Every program in your school',
    billedBy:  'Athletic Director is the billing owner.',
    features: [
      'Unlimited programs',
      'Everything in Individual, for every team',
      'Athletic Director dashboard',
      'Unlimited coaches across the school',
      'Add and remove programs any time',
      'Priority support',
    ],
    highlight: true,
  },
}

// Array form for rendering in a stable, intentional order: Individual first,
// School second, so the upgrade reads left-to-right.
export const PLAN_LIST = PLAN_KEYS.map(k => PLANS[k])

// Plan key → the label shown in Settings → Subscription & Billing.
export function planLabel(key) {
  return PLANS[key]?.name ?? null
}

// Trial length, quoted on both pricing surfaces. Must match the
// trial_period_days in api/stripe-checkout.js and the 14-day window
// api/create-account.js writes into accounts.trial_ends_at.
export const TRIAL_DAYS = 14
