// Vercel Edge Function — remove a coach from the account.
//
// WHY THIS EXISTS
//   Removal used to be a direct client-side `supabase.from('profiles').delete()`
//   with no server endpoint. That deletes the profiles row (cascading
//   coach_orgs) but leaves the auth user, their user_metadata and their live
//   session completely intact — and user_metadata still holds the org_id and
//   the ORIGINAL invited role.
//
//   api/accept-invite.js rebuilds a profile from exactly that metadata. So a
//   removed coach could call it and reinstate themselves: profile and
//   coach_orgs both recreated, at their original role. Requiring a JWT on
//   accept-invite did not close this, because a removed coach still holds a
//   valid session; nor did making it insert-only, because after a hard delete
//   there is no profile to refuse to modify — the insert path is genuinely
//   correct-looking.
//
//   This endpoint closes it at the source: clear the metadata so there is
//   nothing left to rebuild from.
//
// ORDER IS LOAD-BEARING — metadata first, THEN the profile delete.
//   clear → delete : if the delete fails, metadata is gone but the coach still
//                    has their profile and full access. Nothing is lost, the
//                    operation is simply incomplete, and a retry finishes it.
//                    accept-invite already 400s on missing org_id, so no
//                    window opens.
//   delete → clear : if the clear fails, the profile is gone and the metadata
//                    survives — which is precisely the vulnerable state. Never
//                    do it in this order.
//
// KNOWN BOUNDARY (accepted 2026-09-24)
//   This guarantee only covers removals that go through this endpoint. Deleting
//   a profiles row directly — SQL editor, Supabase dashboard, psql — bypasses
//   it entirely and leaves the metadata behind, recreating the vulnerable
//   state. There is no database-level enforcement of this ordering. If you
//   remove a coach by hand, clear their user_metadata by hand too.
//
// SEMANTICS: removal is PROFILE-LEVEL, not per-program. A coach who belongs to
//   three programs is removed from all three (coach_orgs cascades from
//   profiles). Per-program removal does not exist yet and is separate work —
//   the error copy below says "your program" deliberately vaguely for the
//   single-program case, but callers should not assume org scoping.
//
// AUTH — mirrors the profiles DELETE RLS policy from migration
//   20260518000000 exactly, rather than inventing a narrower rule:
//     AD          → anyone in their account, across programs
//     head_coach  → same org only, and never an AD
//   Head coaches have this capability today; this must not silently remove it.
//
// REFUSALS beyond the RLS policy (new, deliberate):
//   • self-removal — the client already hides the button; enforced here too
//   • the last AD on an account — an account with no AD has nobody who can
//     invite, manage roles, or reach billing, and recovery is manual SQL
//
// REQUIRED ENV VARS:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request:  Authorization: Bearer <supabase jwt>;  body { profileId }
// Response: { ok: true, removed: <profileId> }

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// `code` is machine-readable so the client can show specific copy rather than
// a generic failure; `error` is what gets shown if it doesn't recognise one.
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function sbHeaders(serviceKey) {
  return {
    'Content-Type':  'application/json',
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
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
    console.error('[remove-coach] auth verify network error:', err)
    return { ok: false, status: 502, error: 'Auth verification failed' }
  }
  if (!res.ok) {
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
  return { ok: true, userId }
}

async function loadProfile(supabaseUrl, serviceKey, id) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,org_id,account_id,role,email,full_name&limit=1`
  const res = await fetch(url, { headers: sbHeaders(serviceKey) })
  if (!res.ok) throw new Error(`profile lookup HTTP ${res.status}`)
  const rows = await res.json()
  return (Array.isArray(rows) ? rows[0] : null) ?? null
}

// Counts ADs on an account. Used only when the target is an AD, to refuse
// removing the last one.
async function countAdsForAccount(supabaseUrl, serviceKey, accountId) {
  const url = `${supabaseUrl}/rest/v1/profiles`
    + `?account_id=eq.${encodeURIComponent(accountId)}&role=eq.ad&select=id`
  const res = await fetch(url, { headers: { ...sbHeaders(serviceKey), 'Prefer': 'count=exact' } })
  if (!res.ok) throw new Error(`AD count HTTP ${res.status}`)
  const range = res.headers.get('content-range') ?? ''
  const total = parseInt(range.split('/')[1] ?? '0', 10)
  return Number.isFinite(total) ? total : 0
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[remove-coach] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  let body
  try { body = await req.json() } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  const { profileId } = body
  if (!profileId) return json({ error: 'profileId is required', code: 'missing_profile_id' }, 400)

  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceKey)
  if (!authCheck.ok) return json({ error: authCheck.error }, authCheck.status)
  const callerId = authCheck.userId

  // ── Self-removal: refuse before anything else ──────────────────────────────
  if (callerId === profileId) {
    return json({
      code:  'cannot_remove_self',
      error: "You can't remove yourself. Ask another Athletic Director on your account to do it.",
    }, 403)
  }

  let caller, target
  try {
    caller = await loadProfile(supabaseUrl, serviceKey, callerId)
    target = await loadProfile(supabaseUrl, serviceKey, profileId)
  } catch (err) {
    console.error('[remove-coach] profile lookup failed:', err?.message ?? err)
    return json({ error: 'Could not load profiles — please try again.' }, 502)
  }
  if (!caller) return json({ error: 'Your profile could not be loaded.', code: 'no_caller_profile' }, 403)
  if (!target) return json({ error: 'That coach is no longer on your account.', code: 'target_not_found' }, 404)

  // ── Permission — mirrors the RLS policy in 20260518000000 ─────────────────
  const isAd        = caller.role === 'ad'
  const isHeadCoach = caller.role === 'head_coach'
  const allowed =
    (isAd        && String(target.account_id) === String(caller.account_id)) ||
    (isHeadCoach && String(target.org_id)     === String(caller.org_id) && target.role !== 'ad')

  if (!allowed) {
    console.warn('[remove-coach] refused:', {
      callerId, callerRole: caller.role, targetId: profileId, targetRole: target.role,
    })
    return json({
      code:  'not_permitted',
      error: isHeadCoach
        ? "Head coaches can only remove coaches in their own program, and can't remove an Athletic Director."
        : "You don't have permission to remove this coach.",
    }, 403)
  }

  // ── Last AD on the account: refuse ────────────────────────────────────────
  if (target.role === 'ad') {
    let adCount
    try {
      adCount = await countAdsForAccount(supabaseUrl, serviceKey, target.account_id)
    } catch (err) {
      console.error('[remove-coach] AD count failed:', err?.message ?? err)
      return json({ error: 'Could not verify account administrators — please try again.' }, 502)
    }
    if (adCount <= 1) {
      return json({
        code:  'last_ad',
        error: 'This is the only Athletic Director on the account. Promote another coach to Athletic Director first, otherwise nobody can manage programs, invite coaches, or access billing.',
      }, 409)
    }
  }

  // ── STEP 1: clear the invite metadata FIRST (see the ordering note above) ──
  // Preserve everything else on the record — only org_id and role are the
  // reinstatement fuel. Set to null rather than deleting the keys so the result
  // is falsy regardless of how GoTrue merges the patch; accept-invite's
  // `if (!org_id)` check then refuses with a clear message.
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(profileId)}`, {
      headers: sbHeaders(serviceKey),
    })
    if (!userRes.ok) {
      // A missing auth user is not fatal: there is no metadata to clear, so
      // the reinstatement path is already dead. Proceed to the delete.
      if (userRes.status === 404) {
        console.warn('[remove-coach] no auth user for', profileId, '— nothing to clear')
      } else {
        throw new Error(`admin user lookup HTTP ${userRes.status}`)
      }
    } else {
      const authUser = await userRes.json()
      const meta     = authUser?.user_metadata ?? {}
      const cleared  = { ...meta, org_id: null, role: null }

      const patchRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(profileId)}`, {
        method:  'PUT',
        headers: sbHeaders(serviceKey),
        body:    JSON.stringify({ user_metadata: cleared }),
      })
      if (!patchRes.ok) {
        const text = await patchRes.text().catch(() => '')
        throw new Error(`metadata clear HTTP ${patchRes.status}: ${text}`)
      }
      console.log('[remove-coach] cleared invite metadata for', profileId)
    }
  } catch (err) {
    // Refuse to continue. Deleting the profile now would leave exactly the
    // vulnerable state this endpoint exists to prevent.
    console.error('[remove-coach] metadata clear failed — NOT deleting profile:', err?.message ?? err)
    return json({
      code:  'metadata_clear_failed',
      error: 'Could not fully remove this coach. Nothing was changed — please try again.',
    }, 502)
  }

  // ── STEP 2: delete the profile (coach_orgs cascades) ──────────────────────
  try {
    const delRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}`,
      { method: 'DELETE', headers: { ...sbHeaders(serviceKey), 'Prefer': 'return=representation' } },
    )
    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '')
      throw new Error(`profile delete HTTP ${delRes.status}: ${text}`)
    }
    const rows = await delRes.json().catch(() => [])
    if (!Array.isArray(rows) || rows.length === 0) {
      // Already gone — treat as success. The metadata is cleared either way,
      // which is the outcome that matters.
      console.warn('[remove-coach] delete matched 0 rows (already removed?):', profileId)
    }
  } catch (err) {
    // Metadata is already cleared at this point. That is the SAFE incomplete
    // state: the coach keeps their profile and access, and a retry finishes
    // the job. Report it plainly rather than pretending it worked.
    console.error('[remove-coach] profile delete failed after metadata clear:', err?.message ?? err)
    return json({
      code:  'delete_failed',
      error: 'That coach was not removed — please try again.',
    }, 502)
  }

  console.log('[remove-coach] removed:', {
    by: callerId, callerRole: caller.role, removed: profileId, targetRole: target.role,
  })
  return json({ ok: true, removed: profileId })
}
