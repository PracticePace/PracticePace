// Vercel Edge Function — owner-only business dashboard data
//
// Everything /admin renders comes from this one call: summary cards,
// needs-attention lists, the 12-week chart and the account table. One
// endpoint rather than six because the expensive inputs (every account, every
// Stripe subscription) are shared across all of them — splitting it would
// multiply the Stripe round trips by six for the same page.
//
// ACCESS: see api/_admin.js. Every rejection is a 404.
//
// REQUIRED ENV VARS:
//   ADMIN_EMAILS, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY

import {
  requireAdmin, notFound, json, sbSelect, sbHeaders, stripeList, cached,
} from './_admin.js'

export const config = { runtime: 'edge' }

const DAY = 24 * 60 * 60 * 1000

const PLAN_TIERS = ['individual', 'school']

function daysFromNow(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.ceil((t - Date.now()) / DAY)
}

// Monday-anchored week key, so the 12 bars line up with how people talk about
// weeks rather than with whatever day the query happened to run.
function weekStart(d) {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x
}

export default async function handler(req) {
  if (req.method !== 'GET') return notFound()

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const stripeKey   = process.env.STRIPE_SECRET_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('[admin-stats] Supabase env missing')
    return notFound()
  }

  const auth = await requireAdmin(req, supabaseUrl, serviceKey)
  if (!auth.ok) return notFound()

  try {
    const { value, cachedAt } = await cached('admin-stats', () =>
      build(supabaseUrl, serviceKey, stripeKey))
    return json({ ...value, cachedAt, generatedAt: Date.now() })
  } catch (err) {
    console.error('[admin-stats] failed:', err?.message ?? err)
    if (err?.stack) console.error(err.stack)
    return json({ error: 'Could not load dashboard data.' }, 500)
  }
}

async function build(supabaseUrl, serviceKey, stripeKey) {
  // accounts: select=* on purpose. This table has grown columns across a
  // dozen migrations and the dashboard wants most of them; naming them would
  // mean a 400 on the whole request the next time one is added or renamed.
  // Service role, server-side, and nothing raw is returned to the browser.
  const [accounts, profiles, orgs, coachOrgs] = await Promise.all([
    sbSelect(supabaseUrl, serviceKey, 'accounts?select=*'),
    sbSelect(supabaseUrl, serviceKey, 'profiles?select=id,account_id,org_id,email,full_name,role,created_at'),
    sbSelect(supabaseUrl, serviceKey, 'organizations?select=id,account_id,name'),
    sbSelect(supabaseUrl, serviceKey, 'coach_orgs?select=id,profile_id,org_id'),
  ])

  // ── Stripe: subscriptions keyed by customer ────────────────────────────────
  // One list call covers renewal dates, amounts and attached discounts for
  // every account. Degrades to an empty map rather than failing the page —
  // a Stripe outage should cost the renewal column, not the whole dashboard.
  let subsByCustomer = new Map()
  let stripeError = null
  if (stripeKey) {
    try {
      const subs = await stripeList('/subscriptions?status=all', stripeKey)
      for (const s of subs) {
        const prev = subsByCustomer.get(s.customer)
        // Keep the most recent per customer; a re-subscribe leaves the old one.
        if (!prev || (s.created ?? 0) > (prev.created ?? 0)) subsByCustomer.set(s.customer, s)
      }
    } catch (err) {
      stripeError = err?.message ?? String(err)
      console.error('[admin-stats] Stripe subscriptions failed:', stripeError)
    }
  } else {
    stripeError = 'STRIPE_SECRET_KEY is not set'
  }

  // ── Index the Supabase side ────────────────────────────────────────────────
  const programCount = new Map()   // account_id → n
  const orgToAccount = new Map()
  for (const o of orgs) {
    orgToAccount.set(o.id, o.account_id)
    programCount.set(o.account_id, (programCount.get(o.account_id) ?? 0) + 1)
  }

  // Coaches per account: profiles pinned to the account, plus anyone holding a
  // coach_orgs row for one of its programs. Counted as a set of profile ids so
  // a coach on three programs counts once.
  const coachSet = new Map()       // account_id → Set(profile_id)
  const addCoach = (acctId, pid) => {
    if (!acctId || !pid) return
    if (!coachSet.has(acctId)) coachSet.set(acctId, new Set())
    coachSet.get(acctId).add(pid)
  }
  for (const p of profiles) addCoach(p.account_id, p.id)
  for (const c of coachOrgs) addCoach(orgToAccount.get(c.org_id), c.profile_id)

  // Owner = the AD, else the earliest profile on the account.
  const ownerByAccount = new Map()
  for (const p of [...profiles].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))) {
    if (!p.account_id) continue
    const cur = ownerByAccount.get(p.account_id)
    if (!cur || (p.role === 'ad' && cur.role !== 'ad')) ownerByAccount.set(p.account_id, p)
  }

  // ── last_sign_in_at lives on auth.users, not profiles ──────────────────────
  const lastSignIn = new Map()
  try {
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
        { headers: sbHeaders(serviceKey) },
      )
      if (!res.ok) break
      const data  = await res.json()
      const users = data?.users ?? []
      for (const u of users) lastSignIn.set(u.id, u.last_sign_in_at ?? null)
      if (users.length < 200) break
    }
  } catch (err) {
    console.warn('[admin-stats] auth user list failed (non-fatal):', err?.message ?? err)
  }

  // ── Per-account rows ───────────────────────────────────────────────────────
  const now  = Date.now()
  const rows = accounts.map(a => {
    const owner = ownerByAccount.get(a.id) ?? null
    const sub   = a.stripe_customer_id ? subsByCustomer.get(a.stripe_customer_id) : null
    const item  = sub?.items?.data?.[0]
    const cents = item?.price?.unit_amount ?? null
    const renewalIso = sub?.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString() : null

    return {
      id:           a.id,
      name:         a.name ?? '(unnamed)',
      ownerEmail:   owner?.email ?? null,
      ownerName:    owner?.full_name ?? null,
      planTier:     a.plan_tier ?? null,
      status:       a.status ?? null,
      trialEndsAt:  a.trial_ends_at ?? null,
      renewalAt:    renewalIso,
      programs:     programCount.get(a.id) ?? 0,
      coaches:      coachSet.get(a.id)?.size ?? 0,
      lastSignIn:   owner ? (lastSignIn.get(owner.id) ?? null) : null,
      promoCode:    a.promo_code ?? null,
      discountCents: a.discount_amount_cents ?? null,
      createdAt:    a.created_at ?? null,
      amountCents:  cents,
      cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
    }
  })

  // ── Summary ────────────────────────────────────────────────────────────────
  const isPaying = r => r.status === 'active'
  const paying   = rows.filter(isPaying)

  const payingByTier = Object.fromEntries(
    PLAN_TIERS.map(t => [t, paying.filter(r => r.planTier === t).length]))
  payingByTier.untiered = paying.filter(r => !PLAN_TIERS.includes(r.planTier)).length

  // ARR = the amount actually being billed per year, after any discount that
  // is currently attached. Both plans are annual, so the subscription amount
  // IS the annual amount — no x12.
  //
  // CAVEAT, surfaced in the UI: our coupons are duration:'once', so a discount
  // reduces only the first year. This figure is therefore "what is billed in
  // the current period", which is the honest number for a cash view and an
  // understatement of steady-state ARR.
  let arrCents = 0
  for (const r of paying) {
    if (r.amountCents == null) continue
    arrCents += Math.max(0, r.amountCents - (r.discountCents ?? 0))
  }

  const liveTrials = rows.filter(r =>
    r.status === 'trialing' && (r.trialEndsAt == null || new Date(r.trialEndsAt).getTime() > now))

  // Conversion: paid ÷ every account created in the window. Defined on signup
  // cohort rather than "trials that ended", because accounts.status only
  // records where a row is NOW — there is no history table to ask how many
  // trials ever existed. Labelled in the UI as signup→paid so the number is
  // not mistaken for something it isn't.
  const convert = cohort => {
    if (cohort.length === 0) return null
    return Math.round((cohort.filter(isPaying).length / cohort.length) * 1000) / 10
  }
  const last30 = rows.filter(r => r.createdAt && now - new Date(r.createdAt).getTime() <= 30 * DAY)

  const summary = {
    payingByTier,
    payingTotal:   paying.length,
    arrCents,
    activeTrials:  liveTrials.length,
    conversionAllTime: convert(rows),
    conversionLast30:  convert(last30),
    cohortAllTime: rows.length,
    cohortLast30:  last30.length,
    pastDue:       rows.filter(r => r.status === 'past_due').length,
    // "canceled in the last 30 days" has the same no-history problem as
    // conversion: there is no canceled_at column. Stripe's subscription
    // canceled_at is the real answer, so use it where a subscription exists.
    canceledLast30: rows.filter(r => {
      if (r.status !== 'canceled') return false
      const sub = r.id && accounts.find(a => a.id === r.id)?.stripe_customer_id
      const s   = sub ? subsByCustomer.get(sub) : null
      const at  = s?.canceled_at ? s.canceled_at * 1000 : null
      return at ? now - at <= 30 * DAY : false
    }).length,
    complimentary: rows.filter(r => r.status === 'complimentary').length,
    totalAccounts: rows.length,
  }

  // ── Needs attention ────────────────────────────────────────────────────────
  const attention = {
    trialsEnding: liveTrials
      .map(r => ({ ...r, daysLeft: daysFromNow(r.trialEndsAt) }))
      .filter(r => r.daysLeft !== null && r.daysLeft <= 7)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .map(r => ({ id: r.id, name: r.name, email: r.ownerEmail, daysLeft: r.daysLeft, trialEndsAt: r.trialEndsAt })),

    pastDue: rows.filter(r => r.status === 'past_due')
      .map(r => ({ id: r.id, name: r.name, email: r.ownerEmail, planTier: r.planTier, amountCents: r.amountCents })),

    renewals: paying
      .map(r => ({ ...r, daysLeft: daysFromNow(r.renewalAt) }))
      .filter(r => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 30)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .map(r => ({
        id: r.id, name: r.name, email: r.ownerEmail, daysLeft: r.daysLeft,
        renewalAt: r.renewalAt, amountCents: r.amountCents,
        cancelAtPeriodEnd: r.cancelAtPeriodEnd,
      })),
  }

  // ── 12-week chart ──────────────────────────────────────────────────────────
  // Sign-ups come from accounts.created_at. "New paid" has no created-at of
  // its own in our DB, so it is bucketed by the Stripe subscription's start —
  // the moment money first changed hands, which is the thing worth plotting.
  const weeks = []
  const cursor = weekStart(new Date())
  for (let i = 11; i >= 0; i--) {
    const start = new Date(cursor.getTime() - i * 7 * DAY)
    weeks.push({ start: start.toISOString(), signups: 0, paid: 0 })
  }
  const bucketFor = ms => {
    const w = weekStart(new Date(ms)).getTime()
    return weeks.findIndex(x => new Date(x.start).getTime() === w)
  }
  for (const a of accounts) {
    if (!a.created_at) continue
    const i = bucketFor(new Date(a.created_at).getTime())
    if (i >= 0) weeks[i].signups += 1
  }
  for (const s of subsByCustomer.values()) {
    const startedMs = (s.start_date ?? s.created ?? 0) * 1000
    if (!startedMs) continue
    const i = bucketFor(startedMs)
    if (i >= 0) weeks[i].paid += 1
  }

  return { summary, attention, weeks, accounts: rows, stripeError }
}
