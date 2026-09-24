// Vercel Edge Function — create a Stripe Checkout Session
// Called by the client when a coach clicks "Start Free Trial" or "Subscribe".
//
// AUTH REQUIRED. This endpoint previously accepted accountId and email straight
// from the request body. Since subscription_data[metadata][accountId] is what
// api/stripe-webhook.js writes entitlement against, letting the caller name the
// account meant the caller chose which account a subscription would land on.
// Both are now derived from the verified session and any values in the body are
// ignored. skipTrial is likewise derived server-side — a client that simply
// omitted it could mint itself a fresh 14-day trial on every checkout.
//
// The only thing still taken from the body is priceId (which plan was clicked).
//
// Auth follows the same shape as api/invite-coach.js and api/delete-program.js:
// the JWT is handed to Supabase /auth/v1/user rather than verified at the edge.
//
// REQUIRED ENV VARS (Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request:  Authorization: Bearer <supabase jwt>;  body { priceId }
// Response: { url }  — redirect the browser to this URL

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

// Verify the inbound Authorization: Bearer <jwt> header by asking Supabase
// to resolve it to a user. We trust Supabase to validate the JWT signature
// and expiry rather than rolling our own JWT verification at the edge.
// Returns the auth email too — that is the address Stripe should bill.
async function verifyCallerJwt(req, supabaseUrl, anonOrAuthKey) {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, error: 'Authorization header required' }
  }
  const jwt = authHeader.slice(7).trim()
  if (!jwt) return { ok: false, status: 401, error: 'Empty bearer token' }

  let res
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'apikey':        anonOrAuthKey,
        'Authorization': `Bearer ${jwt}`,
      },
    })
  } catch (err) {
    console.error('[stripe-checkout] auth verify network error:', err)
    return { ok: false, status: 502, error: 'Auth verification failed' }
  }
  if (!res.ok) {
    // Supabase answers a MALFORMED token with 400/403 and an EXPIRED one with
    // 401. Both are the caller's problem, so both must surface as 401 — the
    // previous `=== 401 ? 401 : 502` mapped a garbage token to 502, which
    // wrongly reads as "our upstream is broken" and would hide a real Supabase
    // outage in monitoring. 502 is now reserved for genuine upstream failure.
    const callerFault = res.status === 400 || res.status === 401 || res.status === 403
    return {
      ok:     false,
      status: callerFault ? 401 : 502,
      error:  callerFault ? 'Invalid or expired session' : 'Auth verification failed',
    }
  }
  const user   = await res.json().catch(() => null)
  const userId = user?.id
  if (!userId) return { ok: false, status: 401, error: 'Auth user missing id' }
  return { ok: true, userId, email: user?.email ?? null }
}

// Look up the caller's profile via the service-role key so RLS doesn't get
// in the way of reading our own profile row during the gate check.
async function loadCallerProfile(supabaseUrl, serviceKey, userId) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,org_id,account_id,role,email&limit=1`
  let res
  try {
    res = await fetch(url, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })
  } catch (err) {
    console.error('[stripe-checkout] profile lookup network error:', err)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  if (!res.ok) {
    console.error('[stripe-checkout] profile lookup HTTP', res.status)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  const rows    = await res.json().catch(() => null)
  const profile = Array.isArray(rows) ? rows[0] : null
  if (!profile?.account_id) {
    return { ok: false, status: 403, error: 'No account is linked to this user' }
  }
  return { ok: true, profile }
}

// The account row drives skipTrial. Reproduces exactly the rule the client
// used to apply (status 'trialing' AND trial_ends_at still in the future) —
// the behaviour is unchanged, it just isn't the caller's call any more.
async function loadAccount(supabaseUrl, serviceKey, accountId) {
  const url = `${supabaseUrl}/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&select=id,status,trial_ends_at&limit=1`
  let res
  try {
    res = await fetch(url, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })
  } catch (err) {
    console.error('[stripe-checkout] account lookup network error:', err)
    return { ok: false, status: 502, error: 'Could not load account' }
  }
  if (!res.ok) {
    console.error('[stripe-checkout] account lookup HTTP', res.status)
    return { ok: false, status: 502, error: 'Could not load account' }
  }
  const rows    = await res.json().catch(() => null)
  const account = Array.isArray(rows) ? rows[0] : null
  if (!account) return { ok: false, status: 403, error: 'Account not found' }
  return { ok: true, account }
}

// Program name is only Stripe customer metadata, but deriving it keeps the
// caller from writing arbitrary strings into our Stripe dashboard.
async function loadOrgName(supabaseUrl, serviceKey, orgId) {
  if (!orgId) return null
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}&select=name&limit=1`,
      { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } },
    )
    if (!res.ok) return null
    const rows = await res.json().catch(() => null)
    return (Array.isArray(rows) ? rows[0]?.name : null) ?? null
  } catch {
    return null   // cosmetic metadata only — never block checkout on this
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // ── Env check ───────────────────────────────────────────────────────────────
  const secretKey   = process.env.STRIPE_SECRET_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!secretKey || !supabaseUrl || !serviceKey) {
    console.error('[stripe-checkout] Missing env:', {
      STRIPE_SECRET_KEY:         !!secretKey,
      VITE_SUPABASE_URL:         !!supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!serviceKey,
    })
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  // ── Parse body — priceId is the ONLY field still honoured ──────────────────
  let body
  try { body = await req.json() } catch (e) {
    console.error('[stripe-checkout] Failed to parse request body:', e.message)
    return json({ error: 'Invalid request body' }, 400)
  }

  const { priceId } = body
  if (!priceId || priceId === 'undefined') {
    console.error('[stripe-checkout] priceId is missing or undefined — check VITE_STRIPE_PRICE_* env vars on the client')
    return json({ error: 'priceId is required — Stripe price environment variables may not be configured.' }, 400)
  }

  // ── 1. Who is calling? ──────────────────────────────────────────────────────
  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceKey)
  if (!authCheck.ok) return json({ error: authCheck.error }, authCheck.status)

  // ── 2. Which account do they own? ──────────────────────────────────────────
  const profCheck = await loadCallerProfile(supabaseUrl, serviceKey, authCheck.userId)
  if (!profCheck.ok) return json({ error: profCheck.error }, profCheck.status)

  const accountId = profCheck.profile.account_id
  const email     = authCheck.email ?? profCheck.profile.email
  if (!email) {
    console.error('[stripe-checkout] No email on auth user or profile for', authCheck.userId)
    return json({ error: 'No email on file for this account.' }, 403)
  }

  // ── 3. Trial eligibility is ours to decide, not the caller's ───────────────
  const acctCheck = await loadAccount(supabaseUrl, serviceKey, accountId)
  if (!acctCheck.ok) return json({ error: acctCheck.error }, acctCheck.status)

  const account   = acctCheck.account
  const skipTrial = account.status === 'trialing'
    && !!account.trial_ends_at
    && new Date(account.trial_ends_at) > new Date()

  const orgName = await loadOrgName(supabaseUrl, serviceKey, profCheck.profile.org_id)

  console.log('[stripe-checkout] authorised request:', { priceId, accountId, skipTrial })

  try {
    // ── Find or create Stripe customer ────────────────────────────────────────
    const customers = await stripeGet(
      `/customers?email=${encodeURIComponent(email)}&limit=1`,
      secretKey
    )
    let customerId = customers.data?.[0]?.id

    if (customerId) {
      console.log('[stripe-checkout] Found existing Stripe customer:', customerId)
    } else {
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
