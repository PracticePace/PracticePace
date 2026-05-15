// Vercel Edge Function — create a Stripe Checkout Session
// Called by the client when a coach clicks "Start Free Trial" or "Subscribe".
//
// REQUIRED ENV VARS (Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY
//
// Request body: { priceId, accountId, email, orgName }
// Response:     { url }  — redirect the browser to this URL

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function stripePost(path, params, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe error ${res.status}`)
  return data
}

async function stripeGet(path, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe error ${res.status}`)
  return data
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // ── Env check ───────────────────────────────────────────────────────────────
  const secretKey = process.env.STRIPE_SECRET_KEY
  console.log('[stripe-checkout] STRIPE_SECRET_KEY defined:', !!secretKey)
  if (!secretKey) {
    console.error('[stripe-checkout] STRIPE_SECRET_KEY is missing — set it in Vercel env vars')
    return json({ error: 'Server misconfigured — STRIPE_SECRET_KEY not set. Contact support.' }, 500)
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body
  try { body = await req.json() } catch (e) {
    console.error('[stripe-checkout] Failed to parse request body:', e.message)
    return json({ error: 'Invalid request body' }, 400)
  }

  const { priceId, accountId, email, orgName, skipTrial } = body
  console.log('[stripe-checkout] Incoming request:', {
    priceId,
    accountId: accountId ?? '(null)',
    email:     email     ?? '(null)',
    orgName:   orgName   ?? '(null)',
    skipTrial: !!skipTrial,
  })

  // ── Validate required fields ─────────────────────────────────────────────────
  if (!priceId || priceId === 'undefined') {
    console.error('[stripe-checkout] priceId is missing or undefined — check VITE_STRIPE_PRICE_* env vars on the client')
    return json({ error: 'priceId is required — Stripe price environment variables may not be configured.' }, 400)
  }
  if (!accountId || accountId === 'undefined') {
    console.error('[stripe-checkout] accountId is missing — org may not be loaded yet')
    return json({ error: 'accountId is required — please reload and try again.' }, 400)
  }
  if (!email) {
    console.error('[stripe-checkout] email is missing')
    return json({ error: 'email is required' }, 400)
  }

  try {
    // ── Find or create Stripe customer ────────────────────────────────────────
    console.log('[stripe-checkout] Looking up Stripe customer for:', email)
    const customers = await stripeGet(
      `/customers?email=${encodeURIComponent(email)}&limit=1`,
      secretKey
    )
    let customerId = customers.data?.[0]?.id

    if (customerId) {
      console.log('[stripe-checkout] Found existing Stripe customer:', customerId)
    } else {
      console.log('[stripe-checkout] No existing customer — creating new one')
      const createParams = new URLSearchParams({ email })
      createParams.set('metadata[accountId]', accountId)
      if (orgName) createParams.set('metadata[orgName]', orgName)
      const customer = await stripePost('/customers', createParams, secretKey)
      customerId = customer.id
      console.log('[stripe-checkout] Created Stripe customer:', customerId)
    }

    // ── Create Checkout Session ───────────────────────────────────────────────
    // skipTrial = true when the coach is converting from an in-app trial.
    // Omitting trial_period_days means Stripe shows "Subscribe" not "Start trial"
    // and charges immediately (or at next billing cycle if prorated).
    console.log('[stripe-checkout] Creating Checkout Session — skipTrial:', !!skipTrial)
    const params = new URLSearchParams({
      customer:                                  customerId,
      mode:                                      'subscription',
      'line_items[0][price]':                   priceId,
      'line_items[0][quantity]':                '1',
      'subscription_data[metadata][accountId]': accountId,
      'subscription_data[metadata][priceId]':   priceId,
      success_url: 'https://practicepace.app/dashboard?subscription=success',
      cancel_url:  'https://practicepace.app/dashboard?subscription=cancelled',
      'metadata[accountId]': accountId,
      'metadata[orgName]':   orgName ?? '',
      'metadata[priceId]':   priceId,
    })

    // Only add trial days for brand-new signups with no prior in-app trial
    if (!skipTrial) {
      params.set('subscription_data[trial_period_days]', '14')
      console.log('[stripe-checkout] Adding 14-day trial to session')
    }

    const session = await stripePost('/checkout/sessions', params, secretKey)
    console.log('[stripe-checkout] Checkout Session created:', session.id, '→', session.url ? 'has URL' : 'NO URL')
    return json({ url: session.url })
  } catch (err) {
    // Log the raw error server-side for diagnostics; return a generic
    // message to the client so we don't leak Stripe internals or DB
    // schema text. See the audit report for the rationale.
    console.error('[stripe-checkout] error:', err?.message ?? err)
    return json({ error: 'Unable to start checkout. Please try again.' }, 500)
  }
}
