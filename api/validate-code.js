// Vercel Edge Function — is this discount code real?
//
// GET /api/validate-code?code=COACHFRIEND
//   → { valid: true,  code, percentOff, amountOffCents }
//   → { valid: false, code }
//
// PUBLIC AND UNAUTHENTICATED, because /pricing has to answer the question for
// a visitor who has no account yet — that is the whole point of a code link.
//
// WHAT IT DELIBERATELY DOES NOT RETURN
// No promotion-code id, no coupon id, no redemption counts, no metadata, no
// note, no expiry. Only enough to render "$699 → $599 first year". The id in
// particular stays server-side: /api/stripe-checkout resolves the code to an
// id itself, so a caller who learned one could not use it for anything, but
// there is no reason to hand it over.
//
// It is still an oracle — someone can ask "is FOO a code?" and find out. That
// is unavoidable for a public discount link (Stripe's own hosted checkout box
// answers the same question), so the mitigation is rate limiting rather than
// secrecy, and the blast radius is a discount we chose to publish anyway.
// Every code also carries its own max_redemptions, so a guessed code is worth
// at most the redemptions left on it.
//
// REQUIRED ENV VARS: STRIPE_SECRET_KEY

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

// Same shape Stripe accepts and the rest of the app normalises to.
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/

// ── Rate limit ───────────────────────────────────────────────────────────────
// In-memory, per warm instance — same best-effort caveat as /api/contact. It
// raises the cost of walking the code space from free to annoying; it is not
// a distributed limiter and does not pretend to be.
const WINDOW_MS  = 10 * 60 * 1000
const MAX_PER_IP = 30
const hits = new Map()

function rateLimited(ip) {
  if (!ip) return false
  const now    = Date.now()
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 500) {
    for (const [k, v] of hits) if (v.every(t => now - t >= WINDOW_MS)) hits.delete(k)
  }
  return recent.length > MAX_PER_IP
}

function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || null
}

async function stripeGet(path, secretKey) {
  const res  = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe GET ${path} → ${res.status}`)
  return data
}

// ── 60s cache ────────────────────────────────────────────────────────────────
// A code link shared with a team means many visitors asking about the same
// code within minutes. Cached by code, so that is one Stripe call, not fifty.
const TTL_MS = 60 * 1000
const cache  = new Map()

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET')     return json({ error: 'Method not allowed' }, 405)

  const secretKey = process.env.STRIPE_SECRET_KEY
  const url  = new URL(req.url)
  const code = String(url.searchParams.get('code') ?? '').trim().toUpperCase()

  // A malformed code is simply not valid. No error — the caller's job is to
  // render "this code isn't valid", and 400 vs 200 doesn't change that.
  if (!CODE_RE.test(code)) return json({ valid: false, code: null })

  if (!secretKey) {
    console.error('[validate-code] STRIPE_SECRET_KEY is not set')
    // Fail CLOSED on display, not on sale: the page shows normal trial
    // pricing and /api/stripe-checkout still falls back to Stripe's own
    // promotion-code box, so the customer can type it there.
    return json({ valid: false, code })
  }

  if (rateLimited(clientIp(req))) {
    console.warn('[validate-code] rate limited', clientIp(req))
    return json({ valid: false, code }, 429)
  }

  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < TTL_MS) return json(hit.value)

  try {
    const found = await stripeGet(
      `/promotion_codes?code=${encodeURIComponent(code)}&active=true&limit=1`, secretKey)
    const promo = found.data?.[0] ?? null

    let value = { valid: false, code }
    if (promo) {
      // Current Stripe versions return promotion.coupon as an ID string, not
      // an expanded object; the legacy shape put an expanded coupon at the
      // top level. Handle both — see api/admin-codes.js for the full note.
      const ref = promo.promotion?.coupon ?? promo.coupon ?? null
      let coupon = typeof ref === 'string' ? null : ref
      if (typeof ref === 'string') {
        coupon = await stripeGet(`/coupons/${encodeURIComponent(ref)}`, secretKey).catch(() => null)
      }
      if (coupon) {
        value = {
          valid:          true,
          code:           promo.code ?? code,
          percentOff:     coupon.percent_off ?? null,
          amountOffCents: coupon.amount_off ?? null,
        }
      }
    }

    cache.set(code, { at: Date.now(), value })
    return json(value)
  } catch (err) {
    // Same reasoning as the missing-key branch: a Stripe hiccup must not
    // block the page, and checkout still offers manual entry.
    console.warn('[validate-code] lookup failed:', err?.message ?? err)
    return json({ valid: false, code })
  }
}
