// Vercel Edge Function — create account, org, and profile during onboarding.
// Uses the service role key so it bypasses RLS entirely.
//
// The first profile in a new account is assigned role='ad' (Athletic
// Director) — they own the account and can manage everything.
//
// ROLES (renamed 2026-05-16 — Commit 2a athletic-terminology refactor):
//   ad / head_coach / assistant_coach / team_manager
//   (formerly owner / admin / coach / readonly)
//
// AUTH REQUIRED (2026-09-24). This endpoint previously had no JWT check and
// took `userId` from the request body, then UPSERTED profiles on that id with
// the service role. Because the upsert is keyed on `id`, naming somebody
// else's user id OVERWROTE their profile row — re-pointing their account_id,
// org_id and email at an attacker-created org. RLS keys off org_id/account_id,
// so the victim lost access to their real program. Other users' profile ids
// are readable from the dashboard (the add-existing-coach picker selects
// profile_id), so this was reachable by any coach against a colleague.
//
// The caller's identity now comes from the verified session only. `userId` and
// `email` in the body are ignored. The existing prevent_self_role_change
// trigger did NOT mitigate this — the service role has auth.uid() = NULL, so
// it passes straight through and writes role='ad'.
//
// planType is likewise no longer accepted: every new account starts
// single_program. Entitlement lives in accounts.price_id, written by
// api/stripe-webhook.js from the live Stripe subscription.
//
// REQUIRED ENV VARS:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request:  Authorization: Bearer <supabase jwt>
//   body:   { fullName, orgName, sport, primaryColor, secondaryColor }
//           userId / email / planType / schoolName are ignored if sent.
//
// Response:
//   { accountId, orgId }   — or 409 if the caller already has a profile.

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
// Mirrors api/invite-coach.js / api/stripe-checkout.js.
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
      headers: { 'apikey': anonOrAuthKey, 'Authorization': `Bearer ${jwt}` },
    })
  } catch (err) {
    console.error('[create-account] auth verify network error:', err)
    return { ok: false, status: 502, error: 'Auth verification failed' }
  }
  if (!res.ok) {
    // Supabase answers a MALFORMED token with 400/403 and an EXPIRED one with
    // 401. Both are the caller's problem, so both surface as 401; 502 is
    // reserved for genuine upstream failure.
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

// Onboarding is a once-per-user action. Re-running it used to silently upsert
// the profile, re-pointing an existing user at a brand-new account and org and
// orphaning everything they had — a bug that looks like data loss and reads
// like nothing at all in the logs. Refuse instead.
async function profileExists(supabaseUrl, serviceKey, userId) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id&limit=1`
  const res = await fetch(url, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  })
  if (!res.ok) throw new Error(`profile lookup HTTP ${res.status}`)
  const rows = await res.json()
  return Array.isArray(rows) && rows.length > 0
}

function sbHeaders(serviceKey) {
  return {
    'Content-Type':  'application/json',
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer':        'return=representation',
  }
}

async function sbInsert(supabaseUrl, serviceKey, table, data) {
  const res  = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method:  'POST',
    headers: sbHeaders(serviceKey),
    body:    JSON.stringify(data),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Insert into ${table} failed (${res.status}): ${text}`)
  const rows = JSON.parse(text)
  return Array.isArray(rows) ? rows[0] : rows
}

async function sbUpsert(supabaseUrl, serviceKey, table, data, onConflict) {
  const res  = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method:  'POST',
    headers: {
      ...sbHeaders(serviceKey),
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(data),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Upsert into ${table} failed (${res.status}): ${text}`)
  const rows = JSON.parse(text)
  return Array.isArray(rows) ? rows[0] : rows
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  console.log('[create-account] env check:', {
    VITE_SUPABASE_URL:         !!supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: !!serviceKey,
  })

  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server misconfigured — missing Supabase env vars' }, 500)
  }

  let body
  try { body = await req.json() } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  // userId / email / planType / schoolName are deliberately NOT destructured.
  // Identity comes from the verified session below; the tier is forced; and
  // schoolName was accepted but never read by anything.
  const {
    fullName, orgName, sport,
    primaryColor = '#cc1111', secondaryColor = '#ffffff',
  } = body

  if (!orgName || !sport) {
    return json({ error: 'orgName and sport are required' }, 400)
  }

  // ── Who is calling? Identity is the session's, never the body's ───────────
  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceKey)
  if (!authCheck.ok) return json({ error: authCheck.error }, authCheck.status)

  const userId = authCheck.userId
  const email  = authCheck.email
  if (!email) {
    console.error('[create-account] auth user has no email:', userId)
    return json({ error: 'No email on file for this account.' }, 403)
  }

  // ── Onboarding runs once. A second run would re-point an existing user at
  //    a brand-new account/org, orphaning everything they already had. ──────
  try {
    if (await profileExists(supabaseUrl, serviceKey, userId)) {
      return json({
        error: 'This account has already completed onboarding. Reload the page to go to your dashboard — if something looks wrong, contact support rather than signing up again.',
      }, 409)
    }
  } catch (err) {
    console.error('[create-account] profile existence check failed:', err?.message ?? err)
    return json({ error: 'Could not verify account state — please try again.' }, 502)
  }

  console.log('[create-account] authorised:', { userId, orgName, sport })

  try {
    // 1. Create account row — trial starts immediately.
    //
    // The accounts table carries THREE related columns, each with its own
    // CHECK constraint:
    //   - account_type : 'school' | 'program'                (plan tier)
    //   - plan_type    : 'school' | 'single_program'         (plan tier — duplicates account_type semantically; kept in sync below)
    //   - plan         : 'monthly' | 'annual'                (billing cycle; not the tier)
    //
    // Earlier code mistakenly wrote 'monthly' into plan_type, which fails
    // accounts_plan_type_check. Set both tier columns from the same source
    // and explicitly write the billing cycle to make the contract visible.
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    // Every new account starts single_program, full stop. The tier used to
    // come from a caller-supplied planType, so anyone could self-declare
    // 'school' at signup. It is not a purchase — entitlement is
    // accounts.price_id, written by api/stripe-webhook.js from the live Stripe
    // subscription, and the program cap reads that. The onboarding plan picker
    // remains a pre-sales preference; the real choice happens at checkout.
    const account = await sbInsert(supabaseUrl, serviceKey, 'accounts', {
      name:          orgName,
      account_type:  'program',
      plan_type:     'single_program',
      plan:          'monthly',
      status:        'trialing',
      trial_ends_at: trialEndsAt,
    })
    console.log('[create-account] account created:', account.id)

    // 2. Create organization row
    const slug = `${slugify(orgName)}-${Date.now()}`
    const org  = await sbInsert(supabaseUrl, serviceKey, 'organizations', {
      account_id:      account.id,
      name:            orgName,
      slug,
      sport:           sport.toLowerCase(),
      primary_color:   primaryColor,
      secondary_color: secondaryColor,
    })
    console.log('[create-account] org created:', org.id)

    // 3. Upsert profile — safe to upsert in case a partial row exists.
    //    role='ad' = the account owner (Athletic Director). All onboarding
    //    flows start here regardless of plan tier; if the account turns
    //    out to be single-program, the UI labels them "Head Coach" in
    //    most surfaces (see roleLabel() in src/lib/permissions.js).
    await sbUpsert(supabaseUrl, serviceKey, 'profiles', {
      id:         userId,
      account_id: account.id,
      org_id:     org.id,
      email,
      role:       'ad',
      full_name:  fullName ?? '',
    }, 'id')
    console.log('[create-account] profile upserted for user:', userId)

    return json({ accountId: account.id, orgId: org.id })
  } catch (err) {
    console.error('[create-account] error:', err.message)
    return json({ error: err.message ?? 'Account creation failed' }, 500)
  }
}
