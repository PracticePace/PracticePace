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
async function loadCallerProfile(supabaseUrl, serviceKey, userId) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,org_id,role&limit=1`
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
  const { org_id: callerOrgId, role: callerRole } = prof.profile

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
  // Caller must be ad or head_coach AND must be inviting into THEIR OWN org.
  // (Cross-program invites — e.g. an AD inviting into a sibling program —
  // are intentionally NOT supported by this endpoint in the P0 hardening.
  // Lifting that constraint is part of Commit 2b; needs the multi-program
  // model wired up first.)
  if (callerRole !== 'ad' && callerRole !== 'head_coach') {
    console.warn('[invite-coach] insufficient role for', callerUserId, '— has', callerRole)
    return json({ error: 'Forbidden' }, 403)
  }
  if (org_id !== callerOrgId) {
    console.warn(
      '[invite-coach] org_id mismatch — caller', callerUserId, 'is in', callerOrgId,
      'but tried to invite into', org_id
    )
    return json({ error: 'Forbidden' }, 403)
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
