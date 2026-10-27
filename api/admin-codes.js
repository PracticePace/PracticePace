// Vercel Edge Function — owner-only discount code manager
//
// GET                      list promotion codes with redemption counts + state
// POST { action:'create' } new coupon + promotion code
// POST { action:'deactivate', id } switch a promotion code off
//
// Stripe models a discount as TWO objects: a coupon (what the discount is)
// and a promotion code (the string a customer types, pointing at a coupon).
// Create makes both: a coupon with duration:'once' — a code is a sign-up
// incentive, not a permanent price cut — and a promotion code carrying the
// code name, max redemptions and expiry.
//
// API SHAPE (2026-10-26). Current Stripe versions replaced the top-level
// `coupon` parameter on promotion_codes with a `promotion` object:
//
//   OLD   coupon=co_123
//   NEW   promotion[type]=coupon  promotion[coupon]=co_123
//
// Sending the old one now fails with "Received unknown parameter: coupon".
// The RESPONSE changed to match: there is no expanded `coupon` object any
// more, only `promotion.coupon` holding the coupon ID as a STRING. So the
// list below can no longer read percent_off/amount_off straight off the
// promotion code — it fetches the coupons separately and joins them.
//
// We send no Stripe-Version header (every call here is raw fetch, not the
// SDK — `stripe` is in package.json but imported nowhere), so the account's
// default API version governs. Reads below accept BOTH shapes so a version
// change in either direction doesn't blank the dashboard.
//
// WHY A CODE CANNOT BE DELETED, ONLY DEACTIVATED
// Stripe keeps promotion codes for the life of the subscriptions that used
// them. Deactivating stops new redemptions and leaves the audit trail intact,
// which is also what accounts.promo_code depends on to stay meaningful.
//
// ACCESS: see api/_admin.js. Every rejection is a 404.

import {
  requireAdmin, notFound, json, stripePost, stripeList, cached, invalidate,
} from './_admin.js'

export const config = { runtime: 'edge' }

// Stripe accepts a-z A-Z 0-9 and some punctuation; keep it to the subset that
// survives being read aloud to a coach over the phone.
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/

export default async function handler(req) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const stripeKey   = process.env.STRIPE_SECRET_KEY

  if (!supabaseUrl || !serviceKey) return notFound()

  const auth = await requireAdmin(req, supabaseUrl, serviceKey)
  if (!auth.ok) return notFound()

  if (!stripeKey) {
    console.error('[admin-codes] STRIPE_SECRET_KEY is not set')
    return json({ error: 'Stripe is not configured in this environment.' }, 503)
  }

  try {
    if (req.method === 'GET')  return await listCodes(stripeKey)
    if (req.method === 'POST') return await write(req, stripeKey, auth.email)
    return notFound()
  } catch (err) {
    console.error('[admin-codes] failed:', err?.message ?? err)
    // Stripe's validation messages are safe to show an owner and are the only
    // way they'd learn "that code already exists".
    return json({ error: err?.message ?? 'Something went wrong.' }, 400)
  }
}

// ── List ─────────────────────────────────────────────────────────────────────

async function listCodes(stripeKey) {
  const { value, cachedAt } = await cached('admin-codes', async () => {
    const codes = await stripeList('/promotion_codes', stripeKey, { max: 200 })

    // promotion.coupon is an ID, not an object. One list call for every
    // coupon beats one GET per code — a dashboard with 50 codes would
    // otherwise make 50 round trips behind a 60-second cache.
    const couponById = new Map()
    try {
      for (const c of await stripeList('/coupons', stripeKey, { max: 300 })) {
        couponById.set(c.id, c)
      }
    } catch (err) {
      // Non-fatal: the codes still list, the discount column reads "—".
      console.warn('[admin-codes] coupon list failed (non-fatal):', err?.message ?? err)
    }

    return codes.map(p => {
      // New shape first, legacy second. On the old API `p.coupon` was the
      // expanded object; on the new one it is promotion.coupon, an ID.
      const couponId = typeof p.promotion?.coupon === 'string' ? p.promotion.coupon
        : p.promotion?.coupon?.id ?? (typeof p.coupon === 'string' ? p.coupon : p.coupon?.id) ?? null
      const c = couponById.get(couponId)
        ?? (typeof p.coupon === 'object' && p.coupon ? p.coupon : null)
        ?? (typeof p.promotion?.coupon === 'object' && p.promotion.coupon ? p.promotion.coupon : null)
        ?? {}

      const expiresMs = p.expires_at ? p.expires_at * 1000 : null
      const expired   = expiresMs !== null && expiresMs < Date.now()
      const exhausted = p.max_redemptions != null && (p.times_redeemed ?? 0) >= p.max_redemptions
      return {
        id:             p.id,
        code:           p.code,
        active:         !!p.active && !expired && !exhausted,
        rawActive:      !!p.active,
        expired,
        exhausted,
        timesRedeemed:  p.times_redeemed ?? 0,
        maxRedemptions: p.max_redemptions ?? null,
        expiresAt:      expiresMs ? new Date(expiresMs).toISOString() : null,
        percentOff:     c.percent_off ?? null,
        amountOffCents: c.amount_off ?? null,
        // The note the owner typed at creation, stashed on both objects.
        note:           p.metadata?.note ?? c.metadata?.note ?? null,
        createdAt:      p.created ? new Date(p.created * 1000).toISOString() : null,
      }
    }).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  })
  return json({ codes: value, cachedAt })
}

// ── Create / deactivate ──────────────────────────────────────────────────────

async function write(req, stripeKey, actorEmail) {
  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }

  if (body?.action === 'deactivate') {
    const id = String(body?.id ?? '')
    if (!id.startsWith('promo_')) return json({ error: 'Unknown code.' }, 400)
    const params = new URLSearchParams({ active: 'false' })
    const updated = await stripePost(`/promotion_codes/${encodeURIComponent(id)}`, params, stripeKey)
    console.log('[admin-codes]', actorEmail, 'deactivated', updated.code)
    invalidate('admin-codes')
    return json({ ok: true, id: updated.id, code: updated.code, active: updated.active })
  }

  if (body?.action !== 'create') return json({ error: 'Unknown action.' }, 400)

  // ── Validate ───────────────────────────────────────────────────────────────
  const code = String(body?.code ?? '').trim().toUpperCase()
  if (!CODE_RE.test(code)) {
    return json({ error: 'Code must be 3-40 characters: letters, numbers, - or _.' }, 400)
  }

  const kind   = body?.kind                       // 'percent' | 'amount'
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ error: 'Enter a discount amount greater than zero.' }, 400)
  }
  if (kind === 'percent' && amount > 100) {
    return json({ error: 'A percentage discount cannot be more than 100%.' }, 400)
  }
  if (kind !== 'percent' && kind !== 'amount') {
    return json({ error: 'Choose $ off or % off.' }, 400)
  }

  // Default 1 — a code is for one coach unless the owner says otherwise.
  const maxRedemptions = body?.maxRedemptions == null || body.maxRedemptions === ''
    ? 1 : Number(body.maxRedemptions)
  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
    return json({ error: 'Max redemptions must be a whole number of 1 or more.' }, 400)
  }

  let expiresAt = null
  if (body?.expiresAt) {
    // A date input gives YYYY-MM-DD; expire at the END of that day so a code
    // dated today is still usable today.
    const ms = new Date(`${body.expiresAt}T23:59:59Z`).getTime()
    if (!Number.isFinite(ms)) return json({ error: 'That expiry date is not valid.' }, 400)
    if (ms < Date.now())      return json({ error: 'That expiry date is in the past.' }, 400)
    expiresAt = Math.floor(ms / 1000)
  }

  const note = String(body?.note ?? '').trim().slice(0, 300)

  // ── 1. Coupon: WHAT the discount is ───────────────────────────────────────
  const couponParams = new URLSearchParams({ duration: 'once', name: code })
  if (kind === 'percent') {
    couponParams.set('percent_off', String(amount))
  } else {
    // Dollars in, cents to Stripe.
    couponParams.set('amount_off', String(Math.round(amount * 100)))
    couponParams.set('currency', 'usd')
  }
  if (note) couponParams.set('metadata[note]', note)
  couponParams.set('metadata[created_by]', actorEmail)
  const coupon = await stripePost('/coupons', couponParams, stripeKey)

  // ── 2. Promotion code: the STRING a customer types ────────────────────────
  // promotion[type]/promotion[coupon], NOT the retired top-level `coupon`.
  const promoParams = new URLSearchParams({
    'promotion[type]':   'coupon',
    'promotion[coupon]': coupon.id,
    code,
    max_redemptions:     String(maxRedemptions),
  })
  if (expiresAt) promoParams.set('expires_at', String(expiresAt))
  if (note) promoParams.set('metadata[note]', note)
  promoParams.set('metadata[created_by]', actorEmail)

  let promo
  try {
    promo = await stripePost('/promotion_codes', promoParams, stripeKey)
  } catch (err) {
    // The coupon landed but the code didn't — usually a duplicate code name.
    // Delete the orphan so a retry doesn't pile up dead coupons in the Stripe
    // dashboard. Best effort: the real error to report is the one below.
    try {
      await fetch(`https://api.stripe.com/v1/coupons/${coupon.id}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${stripeKey}` },
      })
    } catch (cleanupErr) {
      console.warn('[admin-codes] orphan coupon cleanup failed:', cleanupErr?.message ?? cleanupErr)
    }
    throw err
  }

  console.log('[admin-codes]', actorEmail, 'created', promo.code)
  invalidate('admin-codes')
  return json({
    ok: true,
    code: {
      id: promo.id, code: promo.code, active: promo.active,
      timesRedeemed: 0, maxRedemptions,
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      percentOff:     kind === 'percent' ? amount : null,
      amountOffCents: kind === 'amount'  ? Math.round(amount * 100) : null,
      note: note || null,
      createdAt: new Date().toISOString(),
    },
  })
}
