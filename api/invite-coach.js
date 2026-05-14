// Vercel Edge Function — Supabase coach invite
// Calls auth.admin.inviteUserByEmail() server-side so the service role key
// never touches the browser.
//
// SECURITY (added 2026-05-15 — P0 fix):
//   This endpoint REQUIRES a valid Supabase JWT in the Authorization header.
//   We verify the JWT server-side (Supabase /auth/v1/user), look up the
//   caller's profile via service-role, and only then allow the invite IFF
//   the caller has role ∈ {ad, head_coach} AND the org_id in the request
//   body matches the caller's own profiles.org_id. Without this, anyone on
//   the internet could POST here with arbitrary {email, org_id, role:'ad'}
//   and self-invite as AD of any program whose UUID they guessed.
//
// ROLES (renamed 2026-05-16 — Commit 2a athletic-terminology refactor):
//   ad / head_coach / assistant_coach / team_manager
//   (formerly owner / admin / coach / readonly)
//
// VERCEL ENV VARS REQUIRED (Settings → Environment Variables):
//   VITE_SUPABASE_URL        — already set (your Supabase project URL)
//   SUPABASE_SERVICE_ROLE_KEY — from Supabase → Settings → API → service_role key
//
// SUPABASE AUTH REQUIRED (Authentication → URL Configuration → Redirect URLs):
//   Add:  https://www.practicepace.app/invite

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
// Returns { ok: true, userId } on success, or { ok: false, status, error }
// on any failure (missing header, malformed token, expired, etc.).
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
    console.error('[invite-coach] auth verify network error:', err)
    return { ok: false, status: 502, error: 'Auth verification failed' }
  }
  if (!res.ok) {
    // 401 from Supabase = invalid / expired JWT. Anything else = upstream issue.
    return { ok: false, status: res.status === 401 ? 401 : 502, error: 'Invalid or expired session' }
  }
  const user = await res.json().catch(() => null)
  const userId = user?.id
  if (!userId) return { ok: false, status: 401, error: 'Auth user missing id' }
  return { ok: true, userId }
}

// Look up the caller's profile via the service-role key so RLS doesn't get
// in the way of reading our own profile row during the gate check.
//
// account_id is required for the AD cross-program-invite check below —
// an AD can invite into any org under their account, not just the org
// pinned on their profile.
async function loadCallerProfile(supabaseUrl, serviceKey, userId) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,org_id,account_id,role&limit=1`
  let res
  try {
    res = await fetch(url, {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    })
  } catch (err) {
    console.error('[invite-coach] profile lookup network error:', err)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  if (!res.ok) {
    console.error('[invite-coach] profile lookup HTTP', res.status)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  const rows = await res.json().catch(() => null)
  const profile = Array.isArray(rows) ? rows[0] : null
  if (!profile) return { ok: false, status: 403, error: 'No profile for caller' }
  return { ok: true, profile }
}

// Look up the target organization (the one the caller is inviting INTO)
// to check its account_id. Used only on the AD path — for head_coach we
// stick with the cheaper profile.org_id equality check.
//
// Returns { ok: true, accountId } on success or { ok: false, status,
// error } on failure / not-found.
async function loadOrgAccountId(supabaseUrl, serviceKey, orgId) {
  const url = `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}&select=account_id&limit=1`
  let res
  try {
    res = await fetch(url, {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    })
  } catch (err) {
    console.error('[invite-coach] org lookup network error:', err)
    return { ok: false, status: 502, error: 'Could not load target org' }
  }
  if (!res.ok) {
    console.error('[invite-coach] org lookup HTTP', res.status)
    return { ok: false, status: 502, error: 'Could not load target org' }
  }
  const rows = await res.json().catch(() => null)
  const row  = Array.isArray(rows) ? rows[0] : null
  if (!row) return { ok: false, status: 404, error: 'Target organization not found' }
  return { ok: true, accountId: row.account_id }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl     = process.env.VITE_SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[invite-coach] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  // ── 1. Verify the caller's JWT ─────────────────────────────────────────────
  // Use the service-role key as the apikey for /auth/v1/user — it's the only
  // key we have at the edge and Supabase accepts it for the user-resolve
  // endpoint when paired with a user's JWT in the Authorization header.
  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceRoleKey)
  if (!authCheck.ok) {
    console.warn('[invite-coach] auth rejected:', authCheck.status, authCheck.error)
    // Generic message back to the client — don't leak whether the token was
    // missing vs malformed vs expired.
    return json({ error: 'Unauthorized' }, authCheck.status === 401 ? 401 : 502)
  }
  const callerUserId = authCheck.userId

  // ── 2. Load the caller's profile ──────────────────────────────────────────
  const prof = await loadCallerProfile(supabaseUrl, serviceRoleKey, callerUserId)
  if (!prof.ok) {
    console.warn('[invite-coach] profile load failed for', callerUserId, ':', prof.error)
    return json({ error: 'Forbidden' }, prof.status === 502 ? 502 : 403)
  }
  const {
    org_id:     callerOrgId,
    account_id: callerAccountId,
    role:       callerRole,
  } = prof.profile

  // ── 3. Parse the request body ─────────────────────────────────────────────
  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  const { email, name, role, org_id } = body
  if (!email || !org_id) {
    return json({ error: 'email and org_id are required' }, 400)
  }

  // ── 4. Authorisation gates ────────────────────────────────────────────────
  // Caller must be ad or head_coach. The org_id scope check is role-aware
  // (this is the bit Commit 2b's program switcher needs):
  //
  //   • AD          — may invite into ANY org belonging to their account.
  //                   When an AD has switched program context via the
  //                   header switcher, the request body's org_id is the
  //                   active org (e.g. Girls Basketball), NOT the AD's
  //                   pinned profile.org_id (e.g. Football). The gate
  //                   walks one extra hop — look up the target org's
  //                   account_id and require it to match the caller's
  //                   account_id.
  //   • head_coach  — restricted to their own program. The request body's
  //                   org_id must equal profile.org_id. Head coaches don't
  //                   have program-switching power, so this is the same
  //                   tight check the P0 hardening shipped.
  //   • other roles — already rejected at the role gate.
  if (callerRole !== 'ad' && callerRole !== 'head_coach') {
    console.warn('[invite-coach] insufficient role for', callerUserId, '— has', callerRole)
    return json({ error: 'Forbidden' }, 403)
  }

  if (callerRole === 'ad') {
    if (!callerAccountId) {
      console.warn('[invite-coach] AD caller has no account_id:', callerUserId)
      return json({ error: 'Forbidden' }, 403)
    }
    const target = await loadOrgAccountId(supabaseUrl, serviceRoleKey, org_id)
    if (!target.ok) {
      console.warn('[invite-coach] target org lookup failed:', target.status, target.error)
      return json({ error: target.status === 404 ? 'Program not found' : 'Forbidden' }, target.status)
    }
    if (target.accountId !== callerAccountId) {
      console.warn(
        '[invite-coach] AD cross-account invite blocked — caller acct',
        callerAccountId, 'target acct', target.accountId, 'org_id', org_id
      )
      return json({ error: 'Forbidden' }, 403)
    }
  } else {
    // callerRole === 'head_coach'
    if (org_id !== callerOrgId) {
      console.warn(
        '[invite-coach] org_id mismatch — head_coach', callerUserId, 'in', callerOrgId,
        'tried to invite into', org_id
      )
      return json({ error: 'Forbidden' }, 403)
    }
  }

  // The invited role itself is also constrained — defence-in-depth so a
  // head_coach can't promote anyone above their own privilege via this
  // endpoint. Default 'assistant_coach'; allow {assistant_coach,
  // team_manager, head_coach}. AD promotions go through a different
  // (manual) path so a single rogue head_coach can't escalate.
  const invitedRole = role ?? 'assistant_coach'
  if (!['assistant_coach', 'team_manager', 'head_coach'].includes(invitedRole)) {
    console.warn('[invite-coach] disallowed invited role:', invitedRole)
    return json({ error: 'Invalid role' }, 400)
  }

  // ── 5. Call Supabase Admin invite endpoint ────────────────────────────────
  let res
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/invite`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        email,
        data: {
          org_id,
          role:      invitedRole,
          full_name: name?.trim() ?? '',
        },
        redirect_to: 'https://www.practicepace.app/invite',
      }),
    })
  } catch (err) {
    console.error('[invite-coach] Network error reaching Supabase:', err)
    return json({ error: 'Could not reach Supabase — try again.' }, 502)
  }

  const text = await res.text()

  if (!res.ok) {
    console.error('[invite-coach] Supabase error:', res.status, text)
    let errMsg = `Invite failed (${res.status})`
    try { errMsg = JSON.parse(text)?.msg ?? JSON.parse(text)?.message ?? errMsg } catch {}
    return json({ error: errMsg }, res.status)
  }

  return json({ ok: true })
}
