// ── _admin.js ─────────────────────────────────────────────────────────────────
// Shared plumbing for the owner-only admin endpoints (admin-stats, admin-codes).
//
// The leading underscore keeps Vercel from routing this as an endpoint.
//
// THE ACCESS RULE: 404, NOT 403.
// A 403 confirms the endpoint exists and that you simply aren't on the list,
// which tells an attacker the admin surface is real and worth attacking. Every
// rejection here — no token, bad token, good token for a non-admin, ADMIN_EMAILS
// unset — returns the same 404 with the same body. The /admin page renders the
// ordinary marketing 404 on the same signal, so the route is indistinguishable
// from a typo for anyone who isn't an owner.
//
// REQUIRED ENV VARS:
//   ADMIN_EMAILS              comma-separated, server-only, NEVER VITE_-prefixed
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY service role — reads everything, bypasses RLS
//   STRIPE_SECRET_KEY         renewal dates, amounts, promotion codes
//
// The service-role key is used ONLY here, on the server. Nothing in this file
// is reachable from the browser bundle, and no raw row ever leaves an endpoint
// without being reshaped first.

// ── Access ───────────────────────────────────────────────────────────────────

export function notFound() {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status:  404,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

// Verify the bearer token AND that it belongs to an owner.
//
// Returns { ok: true, email } or { ok: false } — deliberately no reason code.
// The caller's only correct response to a failure is notFound(), so a richer
// result would just be an invitation to leak which check failed.
export async function requireAdmin(req, supabaseUrl, serviceKey) {
  const allowed = adminEmails()
  if (allowed.length === 0) {
    console.error('[admin] ADMIN_EMAILS is not set — refusing every request')
    return { ok: false }
  }

  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) return { ok: false }
  const jwt = header.slice(7).trim()
  if (!jwt) return { ok: false }

  let res
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${jwt}` },
    })
  } catch (err) {
    console.error('[admin] auth verify network error:', err?.message ?? err)
    return { ok: false }
  }
  if (!res.ok) return { ok: false }

  const user  = await res.json().catch(() => null)
  const email = user?.email?.toLowerCase()
  if (!email || !allowed.includes(email)) {
    if (email) console.warn('[admin] rejected non-admin:', email)
    return { ok: false }
  }
  // An anonymous (guest) session has no email, so it can never match — but be
  // explicit rather than relying on that.
  if (user?.is_anonymous) return { ok: false }

  return { ok: true, email }
}

// ── Supabase (service role) ──────────────────────────────────────────────────

export function sbHeaders(serviceKey) {
  return { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
}

export async function sbSelect(supabaseUrl, serviceKey, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: sbHeaders(serviceKey) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase ${path.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ── Stripe (raw REST — the Node SDK can't run on the Edge runtime) ───────────

export async function stripeGet(path, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe GET ${path} → ${res.status}`)
  return data
}

export async function stripePost(path, params, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe POST ${path} → ${res.status}`)
  return data
}

// Walk a Stripe list endpoint to the end. Capped so a bad filter can't turn
// one dashboard load into hundreds of API calls.
export async function stripeList(path, secretKey, { max = 500 } = {}) {
  const out = []
  let startingAfter = null
  for (let page = 0; page < 10; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const url = `${path}${sep}limit=100${startingAfter ? `&starting_after=${startingAfter}` : ''}`
    const data = await stripeGet(url, secretKey)
    out.push(...(data.data ?? []))
    if (!data.has_more || out.length >= max) break
    startingAfter = out[out.length - 1]?.id
    if (!startingAfter) break
  }
  return out
}

// ── 60-second cache ──────────────────────────────────────────────────────────
// Module scope, so it lives as long as the warm Edge instance and no longer.
// Genuinely best-effort: several instances mean several caches, and a cold
// start means a miss. That is the right size for this — the job is to stop
// one owner refreshing the page from making a dozen Stripe round trips, not
// to be a correct distributed cache. Stale-by-up-to-60s is also the right
// trade for a dashboard nobody bills off to the second.
const TTL_MS = 60 * 1000
const cache  = new Map()   // key → { at, value }

export async function cached(key, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { value: hit.value, cachedAt: hit.at, fromCache: true }
  }
  const value = await fn()
  const at    = Date.now()
  cache.set(key, { at, value })
  return { value, cachedAt: at, fromCache: false }
}

// Called after a write (create / deactivate a code) so the next read is fresh
// rather than showing the owner their own change 60 seconds late.
export function invalidate(prefix = '') {
  for (const k of [...cache.keys()]) {
    if (!prefix || k.startsWith(prefix)) cache.delete(k)
  }
}
