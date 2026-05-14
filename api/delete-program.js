// Vercel Edge Function — delete a program (organization) from an account.
//
// PURPOSE
//   The destructive twin of /api/add-program. Removes an organization
//   row and (via FK CASCADE on every dependent table) all of its
//   scripts / songs / videos / whiteboards / scoreboard_configs /
//   backgrounds / coach_invites. profiles.org_id has ON DELETE SET NULL,
//   so any coach pinned to the deleted org keeps their profile but
//   loses their pinned org_id (they fall back to whichever remaining
//   org Dashboard resolves first on next mount).
//
//   This is irreversible. The endpoint adds two safety gates on top
//   of the RLS one (organizations DELETE policy from migration
//   20260517000000):
//     • Caller must be 'ad' (head_coach DELETE access still exists in
//       RLS for the legacy self-rename case, but program deletion is
//       an account-level decision and we don't want a head_coach
//       deleting their own program).
//     • The account must have ≥ 2 programs after the delete. Deleting
//       the last program would leave the account in a "no programs"
//       state that the Dashboard / org-SELECT logic doesn't handle —
//       no rescue path other than support intervention. Refuse it
//       here and tell the user to delete the account instead if that's
//       really what they want.
//
//   The endpoint also auto-syncs accounts.account_type +
//   accounts.plan_type back to 'program' / 'single_program' if the
//   account drops to exactly 1 program. /api/add-program does the
//   mirror in the other direction.
//
// REQUEST BODY
//   { org_id: <uuid> }     — required; the org to delete.
//
// RESPONSE
//   { ok: true, programCount: <int after delete> }
//
// SECURITY
//   - Authorization: Bearer <jwt> required.
//   - JWT resolved server-side via Supabase /auth/v1/user.
//   - Caller profile loaded via service-role.
//   - Caller role must be 'ad'.
//   - Target org's account_id must match caller's account_id (the AD
//     can only delete programs in their own account).
//
// REQUIRED ENV VARS:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

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

function sbHeaders(serviceKey, extra = {}) {
  return {
    'Content-Type':  'application/json',
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer':        'return=representation',
    ...extra,
  }
}

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
    console.error('[delete-program] auth verify network error:', err)
    return { ok: false, status: 502, error: 'Auth verification failed' }
  }
  if (!res.ok) {
    return { ok: false, status: res.status === 401 ? 401 : 502, error: 'Invalid or expired session' }
  }
  const user = await res.json().catch(() => null)
  const userId = user?.id
  if (!userId) return { ok: false, status: 401, error: 'Auth user missing id' }
  return { ok: true, userId }
}

async function loadCallerProfile(supabaseUrl, serviceKey, userId) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,org_id,account_id,role&limit=1`
  const res = await fetch(url, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  })
  if (!res.ok) return { ok: false, status: 502, error: 'Could not load caller profile' }
  const rows = await res.json().catch(() => null)
  const profile = Array.isArray(rows) ? rows[0] : null
  if (!profile) return { ok: false, status: 403, error: 'No profile for caller' }
  return { ok: true, profile }
}

async function loadTargetOrg(supabaseUrl, serviceKey, orgId) {
  const url = `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}&select=id,account_id,name&limit=1`
  const res = await fetch(url, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  })
  if (!res.ok) return { ok: false, status: 502, error: 'Could not load target org' }
  const rows = await res.json().catch(() => null)
  const row  = Array.isArray(rows) ? rows[0] : null
  if (!row) return { ok: false, status: 404, error: 'Target organization not found' }
  return { ok: true, org: row }
}

async function countOrgsForAccount(supabaseUrl, serviceKey, accountId) {
  const url = `${supabaseUrl}/rest/v1/organizations?account_id=eq.${encodeURIComponent(accountId)}&select=id`
  const res = await fetch(url, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Prefer': 'count=exact' },
  })
  if (!res.ok) throw new Error(`org count HTTP ${res.status}`)
  const range = res.headers.get('content-range') ?? ''
  const total = parseInt(range.split('/')[1] ?? '0', 10)
  return Number.isFinite(total) ? total : 0
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[delete-program] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  // ── 1. Verify caller JWT ──────────────────────────────────────────────────
  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceRoleKey)
  if (!authCheck.ok) {
    console.warn('[delete-program] auth rejected:', authCheck.status, authCheck.error)
    return json({ error: 'Unauthorized' }, authCheck.status === 401 ? 401 : 502)
  }
  const callerUserId = authCheck.userId

  // ── 2. Load caller profile ────────────────────────────────────────────────
  const prof = await loadCallerProfile(supabaseUrl, serviceRoleKey, callerUserId)
  if (!prof.ok) {
    console.warn('[delete-program] profile load failed for', callerUserId, ':', prof.error)
    return json({ error: 'Forbidden' }, prof.status === 502 ? 502 : 403)
  }
  const { account_id: callerAccountId, role: callerRole } = prof.profile

  // ── 3. Parse + validate body ──────────────────────────────────────────────
  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  const orgId = String(body?.org_id ?? '').trim()
  if (!orgId) return json({ error: 'org_id is required' }, 400)
  if (!callerAccountId) {
    return json({ error: 'Your account is missing — contact support.' }, 400)
  }

  // ── 4. Authorisation gates ────────────────────────────────────────────────
  if (callerRole !== 'ad') {
    console.warn('[delete-program] non-AD caller', callerUserId, 'role:', callerRole)
    return json({ error: 'Only an Athletic Director can delete a program.' }, 403)
  }

  // Target org must exist AND belong to caller's account.
  const target = await loadTargetOrg(supabaseUrl, serviceRoleKey, orgId)
  if (!target.ok) {
    return json({ error: target.status === 404 ? 'Program not found' : 'Forbidden' }, target.status)
  }
  if (target.org.account_id !== callerAccountId) {
    console.warn(
      '[delete-program] cross-account delete blocked — caller acct',
      callerAccountId, 'target acct', target.org.account_id, 'org_id', orgId,
    )
    return json({ error: 'Forbidden' }, 403)
  }

  // Never let the AD delete the LAST program — the account would end up
  // with no programs, and Dashboard's org-resolve logic doesn't gracefully
  // handle that state. If they really want to wind down the account, that
  // should go through a different flow (cancel subscription, support
  // delete, etc.).
  let currentCount
  try {
    currentCount = await countOrgsForAccount(supabaseUrl, serviceRoleKey, callerAccountId)
  } catch (err) {
    console.error('[delete-program] org count failed:', err?.message ?? err)
    return json({ error: 'Could not check current program count — try again.' }, 502)
  }
  if (currentCount <= 1) {
    return json({
      error:
        'You can\'t delete your only program — your account needs at least one. ' +
        'Cancel your subscription instead if you want to wind down the account.',
    }, 400)
  }

  // ── 5. Delete the org (FK CASCADE wipes content tables; profiles
  //    survive with org_id=NULL via ON DELETE SET NULL). ──────────────────────
  try {
    const delRes = await fetch(
      `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}`,
      {
        method:  'DELETE',
        headers: sbHeaders(serviceRoleKey),
      }
    )
    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '')
      console.error('[delete-program] org delete failed:', delRes.status, text)
      return json({ error: `Could not delete program (${delRes.status}).` }, 500)
    }
  } catch (err) {
    console.error('[delete-program] org delete threw:', err?.message ?? err)
    return json({ error: 'Program deletion failed — try again.' }, 500)
  }

  // ── 6. Auto-sync account tier ─────────────────────────────────────────────
  // Mirror of /api/add-program. If we just dropped from N>1 to 1, the
  // account is now single-program and should flip back to that tier.
  // Non-fatal — drift is self-healing on the next add/delete.
  let newCount = currentCount - 1
  try {
    newCount = await countOrgsForAccount(supabaseUrl, serviceRoleKey, callerAccountId)
    if (newCount === 1) {
      const syncRes = await fetch(
        `${supabaseUrl}/rest/v1/accounts?id=eq.${encodeURIComponent(callerAccountId)}`,
        {
          method:  'PATCH',
          headers: sbHeaders(serviceRoleKey),
          body:    JSON.stringify({ account_type: 'program', plan_type: 'single_program' }),
        }
      )
      if (!syncRes.ok) {
        const text = await syncRes.text().catch(() => '')
        console.warn('[delete-program] account-tier sync failed (non-fatal):', syncRes.status, text)
      }
    }
  } catch (err) {
    console.warn('[delete-program] account-tier sync threw (non-fatal):', err?.message ?? err)
  }

  return json({ ok: true, programCount: newCount })
}
