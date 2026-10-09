// ── _entitlements.js ──────────────────────────────────────────────────────────
// Shared server-side entitlement helper. Imported by api/stripe-checkout.js,
// api/stripe-webhook.js, api/add-program.js, api/invite-coach.js and
// api/accept-invite.js.
//
// The leading underscore keeps Vercel from routing this file as an endpoint —
// it is a module, not a function. Everything here uses only `fetch` and
// `process.env`, so it runs unchanged on both the Edge runtime (every endpoint
// except the webhook) and the Node runtime (the webhook).
//
// WHY THIS EXISTS
// Entitlement used to be decided in two unrelated places: a client-side
// `showPaywall` boolean in Dashboard.jsx that only chose what React rendered,
// and a warn-only cap in add-program.js that logged a decision and then let
// the write through anyway. Neither stopped anything. A coach whose trial had
// lapsed kept full API access, and a one-program subscriber could add programs
// without limit. This module is the one place that answers "what is this
// account entitled to", and the endpoints now refuse rather than log.
//
// PLAN KEYS → PRICE IDS LIVE HERE, SERVER-SIDE, ON PURPOSE
// The client sends a plan key ('individual' | 'school'); the server resolves
// it to a Stripe price ID from its own environment. The price ID is never sent
// to or accepted from the browser. A price ID in the request body is a value
// the caller can substitute — pay for the cheap plan, ask for the expensive
// entitlement — which is exactly what the old `body.priceId` allowed.
//
// The keys must match PLAN_KEYS in src/lib/plans.js and the
// accounts.plan_tier CHECK constraint (migration 20261009000000). Three
// copies is two too many, but the alternative is an Edge function importing
// out of src/, and the CHECK constraint already backstops any drift: a key
// that does not match cannot be written to the column.

export const PLAN_KEYS = ['individual', 'school']

const PLAN_ENV_VARS = {
  individual: 'STRIPE_PRICE_INDIVIDUAL',
  school:     'STRIPE_PRICE_SCHOOL',
}

// How many programs each tier may have. Individual is one program by
// definition; School is unlimited.
const PROGRAM_CAPS = {
  individual: 1,
  school:     Infinity,
}

// Statuses that mean "this account may use the product".
//
// 'complimentary' is a deliberate carve-out for founding customers,
// testimonial partners and comped programs — they never go through Stripe and
// must never be gated. 'trialing' is allowed only while the trial is still
// running; see isEntitled().
//
// 'past_due' is NOT here. Stripe retries a failed renewal for days before
// giving up, and during that window the account keeps read access through the
// client (Dashboard shows the paywall with an "Update Payment Method" button),
// but it does not get to create new programs or onboard new coaches. Those are
// the actions that grow the bill.
const USABLE_STATUSES = new Set(['active', 'trialing', 'complimentary'])

// ── Plan key ⇄ Stripe price id ───────────────────────────────────────────────

export function isPlanKey(key) {
  return typeof key === 'string' && PLAN_KEYS.includes(key)
}

// Returns { ok, priceId } or { ok: false, status, error }.
// A key we don't publish is the caller's fault (400). A key we DO publish but
// have no price configured for is ours (500) — those must not read the same.
export function priceIdForPlanKey(key) {
  if (!isPlanKey(key)) {
    return { ok: false, status: 400, error: 'Unknown plan.' }
  }
  const envVar  = PLAN_ENV_VARS[key]
  const priceId = process.env[envVar]
  if (!priceId) {
    console.error(`[entitlements] ${envVar} is not set — cannot start checkout for plan "${key}"`)
    return { ok: false, status: 500, error: 'This plan is not available right now — contact support.' }
  }
  return { ok: true, priceId }
}

// Reverse direction, used by the webhook to write accounts.plan_tier from the
// price on the live Stripe subscription. Returns null for a price we don't
// recognise — the caller decides what that means.
export function planTierForPriceId(priceId) {
  if (!priceId) return null
  for (const key of PLAN_KEYS) {
    const configured = process.env[PLAN_ENV_VARS[key]]
    if (configured && configured === priceId) return key
  }
  return null
}

// ── Reading an account's entitlement ─────────────────────────────────────────

function sbHeaders(serviceKey) {
  return {
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
  }
}

// Load the billing-relevant columns for one account.
//
// Returns { ok: true, account } or { ok: false, status, error }.
//
// A lookup failure is 503, NOT a silent pass. The old cap evaluated to
// "fail open" on every uncertain path, which was the right call while it was
// advisory and the wrong one now that it decides access: a Supabase blip must
// not hand out unlimited programs. 503 tells the client to retry rather than
// implying the plan is at fault.
export async function loadEntitlement(supabaseUrl, serviceKey, accountId) {
  if (!accountId) return { ok: false, status: 403, error: 'No account is linked to this user.' }

  const url = `${supabaseUrl}/rest/v1/accounts`
    + `?id=eq.${encodeURIComponent(accountId)}`
    + '&select=id,status,plan_tier,price_id,stripe_subscription_id,trial_ends_at&limit=1'

  let res
  try {
    res = await fetch(url, { headers: sbHeaders(serviceKey) })
  } catch (err) {
    console.error('[entitlements] account lookup network error:', err?.message ?? err)
    return { ok: false, status: 503, error: 'Could not check your subscription — please try again.' }
  }
  if (!res.ok) {
    console.error('[entitlements] account lookup HTTP', res.status)
    return { ok: false, status: 503, error: 'Could not check your subscription — please try again.' }
  }

  const rows    = await res.json().catch(() => null)
  const account = Array.isArray(rows) ? rows[0] : null
  if (!account) {
    console.warn('[entitlements] no accounts row for', accountId)
    return { ok: false, status: 403, error: 'Your account is missing — contact support.' }
  }
  return { ok: true, account }
}

// Is this trial running right now?
//
// ONE definition, shared by isEntitled() and programCapFor() so the gate and
// the cap can never disagree about whether a trial is live — a split would
// mean "you may use the product" and "you get one program" landing on
// different sides of the same midnight.
//
// A null trial_ends_at counts as ACTIVE: a trialing row with no end date is a
// trial nobody has bounded, not one that already lapsed. Same for a value
// that won't parse — the column is timestamptz so that shouldn't happen, but
// if it ever does, locking a brand-new signup out on day one is a far worse
// failure than letting one malformed row run long.
export function isTrialActive(account) {
  if (account?.status !== 'trialing') return false
  if (!account?.trial_ends_at) return true
  const endsAt = new Date(account.trial_ends_at)
  if (Number.isNaN(endsAt.getTime())) return true
  return endsAt > new Date()
}

// Is this account allowed to use the product right now?
//
// Returns { entitled, status, reason }. `status` is the raw accounts.status so
// callers can tailor their message (a lapsed trial and a failed card deserve
// different copy).
export function isEntitled(account) {
  const status = account?.status ?? null

  if (!USABLE_STATUSES.has(status)) {
    return { entitled: false, status, reason: `status-${status}` }
  }

  // A trial that has run out is not a subscription. Mirrors the trialExpired
  // rule in Dashboard.jsx so the server and the UI agree on the same moment.
  if (status === 'trialing' && !isTrialActive(account)) {
    return { entitled: false, status, reason: 'trial-expired' }
  }

  return { entitled: true, status, reason: `ok-${status}` }
}

// Message shown to a coach who is blocked. Written for a coach, not an
// operator — it says what happened and what to do, with no status codes.
export function entitlementMessage(reason, status) {
  if (reason === 'trial-expired') {
    return 'Your free trial has ended. Subscribe from Settings → Subscription & Billing to keep going.'
  }
  if (status === 'past_due') {
    return "Your last payment didn't go through. Update your payment method in Settings → Subscription & Billing."
  }
  if (status === 'canceled') {
    return 'Your subscription has ended. Resubscribe from Settings → Subscription & Billing.'
  }
  return 'This needs an active subscription. Check Settings → Subscription & Billing.'
}

// ── Program cap ──────────────────────────────────────────────────────────────

// Programs allowed for an account: a number, or null for "unlimited / do not
// gate". Only consulted after isEntitled() has already said yes.
//
// ── THE TRUTH TABLE ─────────────────────────────────────────────────────────
//
//   status         trial      plan_tier     entitled  cap        why
//   ------------   --------   -----------   --------  ---------  ----------------
//   trialing       live       (any/none)    yes       unlimited  full access
//   trialing       expired    none          NO        1          gate refuses
//   active         –          individual    yes       1          paid tier
//   active         –          school        yes       unlimited  paid tier
//   active         –          none, Stripe  yes       unlimited  config gap: open
//   active         –          none, no sub  yes       unlimited  hand-granted
//   complimentary  –          –             yes       unlimited  comped
//   past_due       –          any           NO        –          gate refuses
//   canceled       –          any           NO        –          gate refuses
//
// ── TRIALS GET EVERYTHING (2026-10-09) ──────────────────────────────────────
// An unexpired trial is unlimited regardless of what the coach clicked during
// onboarding. That click is a pre-sales preference, not a purchase — nothing
// is charged and nothing is committed — so letting it cap the trial meant an
// AD evaluating Practice:Pace for a whole athletic department hit "upgrade to
// add more" before they had been given a reason to. Entitlement starts
// following plan_tier the moment the trial ends, which is the moment there is
// actually a plan to follow.
//
// This reverses the previous note here, which capped trials at Individual to
// avoid a "downgrade surprise on day 15". The surprise is real but it is the
// cheaper problem: a trialing school that built three programs has shown us
// exactly which plan it needs, and that is a far better sales conversation
// than a wall on day two. Enforcement at conversion is unchanged — the cap
// below applies in full the moment status leaves 'trialing'.
//
// ── FAIL-OPEN, NARROWLY ─────────────────────────────────────────────────────
// Two cases return null because we genuinely cannot tell, and refusing would
// punish the customer for our own gap:
//
//   1. A comped / hand-granted account: active with no Stripe subscription at
//      all. These exist by decision and were never sold a tier.
//   2. An account WITH a Stripe subscription whose price we don't recognise —
//      STRIPE_PRICE_* misconfigured, or someone sold a price that isn't in
//      this environment. Logged at error level so it surfaces.
export function programCapFor(account) {
  // Comped accounts are never gated.
  if (account?.status === 'complimentary') return null

  // A live trial outranks everything below, including a plan_tier already
  // written by the webhook for a Stripe-side trial. Must stay above the tier
  // lookup or a trialing 'individual' row would be capped at one program.
  if (isTrialActive(account)) return null

  // Expired trial with nothing paid behind it. isEntitled() already refuses
  // these, so this is belt-and-braces: without it an expired trial would fall
  // through to the hand-granted branch below and be handed unlimited.
  if (account?.status === 'trialing') return PROGRAM_CAPS.individual

  // Paid: the tier decides.
  const tier = account?.plan_tier ?? planTierForPriceId(account?.price_id)
  if (tier && PROGRAM_CAPS[tier] !== undefined) return PROGRAM_CAPS[tier]

  // No recognisable tier — which of the two fail-open cases is it?
  if (!account?.price_id && !account?.stripe_subscription_id) {
    console.log('[entitlements] no Stripe subscription on account — treating program cap as unlimited (manual grant)')
    return null
  }

  console.error(
    '[entitlements] account has a Stripe subscription but an unrecognised price —'
    + ` cannot determine program cap. price_id=${account?.price_id ?? 'null'}.`
    + ' Check STRIPE_PRICE_INDIVIDUAL / STRIPE_PRICE_SCHOOL in this environment.'
  )
  return null
}
