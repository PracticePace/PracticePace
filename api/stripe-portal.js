// Vercel Edge Function — create a Stripe Billing Portal Session
// Lets coaches manage their subscription, update payment method, or cancel.
//
// AUTH REQUIRED. This endpoint previously took `customerId` straight from the
// request body with no authentication at all, so anyone who learned or guessed
// a cus_... id could open that customer's billing portal and read their
// invoices, read their payment methods, and cancel their subscription. The
// customer id is now resolved server-side from the caller's own account row
// and ANY customerId in the body is ignored.
//
// Auth follows the same shape as api/invite-coach.js and api/delete-program.js:
// the JWT is handed to Supabase /auth/v1/user rather than verified at the edge.
//
// REQUIRED ENV VARS:
//   STRIPE_SECRET_KEY
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request:  Authorization: Bearer <supabase jwt>;  body ignored
// Response: { url }

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

// Verify the inbound Authorization: Bearer <jwt> header by asking Supabase
// to resolve it to a user. We trust Supabase to validate the JWT signature
// and expiry rather than rolling our own JWT verification at the edge.
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
    console.error('[stripe-portal] auth verify network error:', err)
    return { ok: false, status: 502, error: 'Auth verification failed' }
  }
  if (!res.ok) {
    return { ok: false, status: res.status === 401 ? 401 : 502, error: 'Invalid or expired session' }
  }
  const user   = await res.json().catch(() => null)
  const userId = user?.id
  if (!userId) return { ok: false, status: 401, error: 'Auth user missing id' }
  return { ok: true, userId }
}

// Look up the caller's profile via the service-role key so RLS doesn't get
// in the way of reading our own profile row during the gate check.
async function loadCallerProfile(supabaseUrl, serviceKey, userId) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,org_id,account_id,role&limit=1`
  let res
  try {
    res = await fetch(url, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })
  } catch (err) {
    console.error('[stripe-portal] profile lookup network error:', err)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  if (!res.ok) {
    console.error('[stripe-portal] profile lookup HTTP', res.status)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  const rows    = await res.json().catch(() => null)
  const profile = Array.isArray(rows) ? rows[0] : null
  if (!profile?.account_id) {
    return { ok: false, status: 403, error: 'No account is linked to this user' }
  }
  return { ok: true, profile }
}

// The billing customer id is read from the caller's OWN account row. This is
// the whole point of the fix — the client never gets to name a customer.
async function loadAccount(supabaseUrl, serviceKey, accountId) {
  const url = `${supabaseUrl}/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&select=id,stripe_customer_id&limit=1`
  let res
  try {
    res = await fetch(url, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })
  } catch (err) {
    console.error('[stripe-portal] account lookup network error:', err)
    return { ok: false, status: 502, error: 'Could not load account' }
  }
  if (!res.ok) {
    console.error('[stripe-portal] account lookup HTTP', res.status)
    return { ok: false, status: 502, error: 'Could not load account' }
  }
  const rows    = await res.json().catch(() => null)
  const account = Array.isArray(rows) ? rows[0] : null
  if (!account) return { ok: false, status: 403, error: 'Account not found' }
  return { ok: true, account }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const secretKey   = process.env.STRIPE_SECRET_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!secretKey || !supabaseUrl || !serviceKey) {
    console.error('[stripe-portal] Missing env:', {
      STRIPE_SECRET_KEY:         !!secretKey,
      VITE_SUPABASE_URL:         !!supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: !!serviceKey,
    })
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  // ── 1. Who is calling? ──────────────────────────────────────────────────────
  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceKey)
  if (!authCheck.ok) return json({ error: authCheck.error }, authCheck.status)

  // ── 2. Which account do they own? ──────────────────────────────────────────
  const profCheck = await loadCallerProfile(supabaseUrl, serviceKey, authCheck.userId)
  if (!profCheck.ok) return json({ error: profCheck.error }, profCheck.status)

  // ── 3. That account's Stripe customer — never the body's ───────────────────
  const acctCheck = await loadAccount(supabaseUrl, serviceKey, profCheck.profile.account_id)
  if (!acctCheck.ok) return json({ error: acctCheck.error }, acctCheck.status)

  const customerId = acctCheck.account.stripe_customer_id
  if (!customerId) {
    return json({ error: 'No billing account yet — subscribe first.' }, 403)
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer:   customerId,
        return_url: 'https://practicepace.app/dashboard',
      }).toString(),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message ?? `Stripe error ${res.status}`)

    return json({ url: data.url })
  } catch (err) {
    // Log the raw error server-side for diagnostics; return a generic
    // message to the client so we don't leak Stripe internals or DB
    // schema text. See the audit report for the rationale.
    console.error('[stripe-portal] error:', err?.message ?? err)
    return json({ error: 'Unable to open billing portal. Please try again.' }, 500)
  }
}
