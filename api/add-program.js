// Vercel Edge Function — add a new program (organization) to an account.
//
// PURPOSE
//   Commit 2b introduces a multi-program account model. This endpoint is
//   the back-end for the "Add Program" flow in Settings. Two distinct
//   call sites converge here:
//
//   1. 1 → 2 transition (the school upgrade):
//      Caller is currently a 'head_coach' on a single-program account.
//      The new program needs an AD designated. Two sub-cases:
//         a. adDesignation = 'self'           — promote caller to 'ad',
//                                              create the new org, return.
//         b. adDesignation = { email, name }  — keep caller as head_coach,
//                                              create the new org, and
//                                              invite { email, name } as
//                                              role='ad' via Supabase admin.
//
//   2. 2 → N (already-AD adding another program):
//      Caller is already 'ad'. No designation step. Just create the org.
//
// WHY SERVER-SIDE
//   - The new organizations INSERT RLS gates on get_my_role() = 'ad', so
//     a head_coach can't INSERT directly from the browser. The 1→2 path
//     needs a service-role hop.
//   - The AD-promotion (UPDATE profiles SET role='ad') is privilege
//     escalation; we cannot let the browser drive it. The server enforces
//     the precondition: caller must currently be head_coach AND the
//     account must currently have exactly 1 program.
//   - The "invite someone else as AD" path needs admin.inviteUserByEmail,
//     which only runs with the service role.
//
// REQUEST BODY
//   {
//     name:           string  // new program name, required
//     sport:          string  // sport slug (matches accounts.sport
//                             //   convention — football, basketball, …),
//                             // required
//     adDesignation:  'self' | { email, name }  // OMIT when caller already
//                                               // 'ad' (already-AD path)
//   }
//
// RESPONSE
//   { ok: true, orgId, promotedToAd?: boolean, invitedAdEmail?: string }
//
// SECURITY GATES
//   - Authorization: Bearer <jwt>  required. JWT verified server-side.
//   - Caller profile loaded via service-role (not the caller's JWT) so
//     we don't depend on the caller's RLS access to their own profile —
//     they obviously have that, but the explicit service-role lookup is
//     defense-in-depth.
//   - If caller is 'head_coach':
//       * Account org count must be exactly 1 (the 1→2 transition only).
//       * adDesignation is required.
//   - If caller is 'ad':
//       * Account can have any number of programs.
//       * adDesignation must be omitted (this isn't the upgrade step).
//   - Any other role → 403.
//   - Invited AD email path additionally requires a non-empty,
//     well-formed email.
//
// ROLES (post-Commit-2a — see migration 20260516000000):
//   ad / head_coach / assistant_coach / team_manager
//   (formerly owner / admin / coach / readonly)
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

// Verify the inbound JWT by asking Supabase to resolve it to a user.
// Same pattern as api/invite-coach.js — Supabase validates signature,
// expiry, and issuer; we trust its decision.
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
    console.error('[add-program] auth verify network error:', err)
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
  let res
  try {
    res = await fetch(url, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })
  } catch (err) {
    console.error('[add-program] profile lookup network error:', err)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  if (!res.ok) {
    console.error('[add-program] profile lookup HTTP', res.status)
    return { ok: false, status: 502, error: 'Could not load caller profile' }
  }
  const rows = await res.json().catch(() => null)
  const profile = Array.isArray(rows) ? rows[0] : null
  if (!profile) return { ok: false, status: 403, error: 'No profile for caller' }
  return { ok: true, profile }
}

async function countOrgsForAccount(supabaseUrl, serviceKey, accountId) {
  const url = `${supabaseUrl}/rest/v1/organizations?account_id=eq.${encodeURIComponent(accountId)}&select=id`
  const res = await fetch(url, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Prefer': 'count=exact' },
  })
  if (!res.ok) throw new Error(`org count HTTP ${res.status}`)
  // Supabase returns the count in the Content-Range header:  "0-N/total"
  const range = res.headers.get('content-range') ?? ''
  const total = parseInt(range.split('/')[1] ?? '0', 10)
  return Number.isFinite(total) ? total : 0
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl     = process.env.VITE_SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[add-program] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  // ── 1. Verify caller JWT ──────────────────────────────────────────────────
  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceRoleKey)
  if (!authCheck.ok) {
    console.warn('[add-program] auth rejected:', authCheck.status, authCheck.error)
    return json({ error: 'Unauthorized' }, authCheck.status === 401 ? 401 : 502)
  }
  const callerUserId = authCheck.userId

  // ── 2. Load caller profile ────────────────────────────────────────────────
  const prof = await loadCallerProfile(supabaseUrl, serviceRoleKey, callerUserId)
  if (!prof.ok) {
    console.warn('[add-program] profile load failed for', callerUserId, ':', prof.error)
    return json({ error: 'Forbidden' }, prof.status === 502 ? 502 : 403)
  }
  const { org_id: callerOrgId, account_id: callerAccountId, role: callerRole } = prof.profile

  // ── 3. Parse + validate body ──────────────────────────────────────────────
  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }

  const name          = String(body?.name ?? '').trim()
  const sport         = String(body?.sport ?? '').trim().toLowerCase()
  // sport_custom_label — only meaningful when sport === 'custom'. Server
  // null-coerces in the other direction so a client mistakenly passing a
  // label with a non-custom sport doesn't pollute the row. See migration
  // 20260521000000 for the column + the SettingsSection mirror.
  const sportCustomLabel = sport === 'custom'
    ? String(body?.sport_custom_label ?? '').trim()
    : null
  const adDesignation = body?.adDesignation ?? null

  if (!name)  return json({ error: 'name is required' }, 400)
  if (!sport) return json({ error: 'sport is required' }, 400)
  if (sport === 'custom' && !sportCustomLabel) {
    return json({ error: 'Custom sport requires a label.' }, 400)
  }
  if (!callerAccountId) {
    return json({ error: 'Your account is missing — contact support.' }, 400)
  }

  // ── 4. Authorisation gates ────────────────────────────────────────────────
  if (callerRole !== 'ad' && callerRole !== 'head_coach') {
    console.warn('[add-program] insufficient role for', callerUserId, '— has', callerRole)
    return json({ error: 'Only an Athletic Director or Head Coach can add a program.' }, 403)
  }

  let orgCount
  try {
    orgCount = await countOrgsForAccount(supabaseUrl, serviceRoleKey, callerAccountId)
  } catch (err) {
    console.error('[add-program] org count failed:', err?.message ?? err)
    return json({ error: 'Could not check current program count — try again.' }, 502)
  }

  // Head-coach path requires the upgrade case (currently 1 program) AND
  // an explicit adDesignation. Caller can't "stay head_coach of one
  // program while adding a second" without designating an AD first.
  if (callerRole === 'head_coach') {
    if (orgCount !== 1) {
      // Either we somehow have 0 programs (broken account) or 2+
      // already (AD should be doing this, not the head_coach).
      return json({
        error: orgCount === 0
          ? 'Your account has no current program — contact support.'
          : 'This account already has multiple programs. Ask your Athletic Director to add new programs.',
      }, 403)
    }
    if (!adDesignation) {
      return json({ error: 'Designate an Athletic Director first.' }, 400)
    }
    const wantsSelf = adDesignation === 'self'
    const wantsInvite =
      adDesignation && typeof adDesignation === 'object'
      && looksLikeEmail(adDesignation.email)
    if (!wantsSelf && !wantsInvite) {
      return json({ error: 'adDesignation must be "self" or { email, name }.' }, 400)
    }
  } else {
    // callerRole === 'ad'. AD shouldn't pass adDesignation — the 1→2
    // upgrade has already happened.
    if (adDesignation) {
      return json({
        error: 'AD designation is only used on the first upgrade to multi-program. Just submit the program details.',
      }, 400)
    }
  }

  // ── 5. Insert the new organization (service role — bypasses RLS) ──────────
  const slug = `${slugify(name)}-${Date.now()}`
  let newOrgId
  try {
    const orgRes = await fetch(`${supabaseUrl}/rest/v1/organizations`, {
      method:  'POST',
      headers: sbHeaders(serviceRoleKey),
      body: JSON.stringify({
        account_id:         callerAccountId,
        name,
        slug,
        sport,
        sport_custom_label: sportCustomLabel,  // null unless sport='custom'
        primary_color:      '#cc1111',
        secondary_color:    '#ffffff',
      }),
    })
    if (!orgRes.ok) {
      const text = await orgRes.text().catch(() => '')
      console.error('[add-program] org insert failed:', orgRes.status, text)
      return json({ error: `Could not create program (${orgRes.status}).` }, 500)
    }
    const rows = await orgRes.json().catch(() => null)
    const row  = Array.isArray(rows) ? rows[0] : rows
    newOrgId = row?.id
    if (!newOrgId) {
      console.error('[add-program] org insert returned no id:', rows)
      return json({ error: 'Program creation returned no ID.' }, 500)
    }
  } catch (err) {
    console.error('[add-program] org insert threw:', err?.message ?? err)
    return json({ error: 'Program creation failed — try again.' }, 500)
  }

  // ── 5b. Auto-sync account tier ────────────────────────────────────────────
  // Albertville-drift fix (migration 20260522000000 was the one-time
  // historical repair; this is the prevent-it-from-happening-again
  // logic). After inserting a new org, if the account now has ≥2
  // programs, flip account_type+plan_type to school. /api/delete-program
  // does the mirror in the other direction.
  //
  // Non-fatal — if this update fails the program is still created and
  // the client gets a 200. Worst case we have a brief drift the next
  // add/delete will heal.
  try {
    const newCount = await countOrgsForAccount(supabaseUrl, serviceRoleKey, callerAccountId)
    if (newCount >= 2) {
      const syncRes = await fetch(
        `${supabaseUrl}/rest/v1/accounts?id=eq.${encodeURIComponent(callerAccountId)}`,
        {
          method:  'PATCH',
          headers: sbHeaders(serviceRoleKey),
          body:    JSON.stringify({ account_type: 'school', plan_type: 'school' }),
        }
      )
      if (!syncRes.ok) {
        const text = await syncRes.text().catch(() => '')
        console.warn('[add-program] account-tier sync failed (non-fatal):', syncRes.status, text)
      }
    }
  } catch (err) {
    console.warn('[add-program] account-tier sync threw (non-fatal):', err?.message ?? err)
  }

  // ── 6. AD-designation side effects ────────────────────────────────────────
  let promotedToAd  = false
  let invitedAdEmail = null

  if (callerRole === 'head_coach') {
    if (adDesignation === 'self') {
      // Promote the caller from head_coach → ad.
      const updRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerUserId)}`,
        {
          method:  'PATCH',
          headers: sbHeaders(serviceRoleKey),
          body:    JSON.stringify({ role: 'ad' }),
        }
      )
      if (!updRes.ok) {
        const text = await updRes.text().catch(() => '')
        // Don't roll back the org — the AD can still be promoted via
        // Settings → Coaches & Staff afterward. Surface the error
        // clearly so the client knows the orgcreation succeeded but the
        // promotion didn't.
        console.error('[add-program] AD self-promotion failed:', updRes.status, text)
        return json({
          ok:    true,
          orgId: newOrgId,
          promotedToAd: false,
          warning: `Program created but Athletic Director promotion failed (${updRes.status}). Promote yourself manually in Settings → Coaches & Staff.`,
        })
      }
      promotedToAd = true
    } else {
      // Invite someone else as AD. The invited user's metadata.org_id
      // points at the NEWLY-created program (they "land" there); they
      // can switch programs once signed in.
      const { email: rawEmail, name: invitedName } = adDesignation
      const email = String(rawEmail || '').trim().toLowerCase()
      let inviteRes
      try {
        inviteRes = await fetch(`${supabaseUrl}/auth/v1/invite`, {
          method:  'POST',
          headers: sbHeaders(serviceRoleKey),
          body: JSON.stringify({
            email,
            data: {
              org_id:    newOrgId,
              role:      'ad',
              full_name: String(invitedName || '').trim(),
            },
            redirect_to: 'https://www.practicepace.app/invite',
          }),
        })
      } catch (err) {
        console.error('[add-program] AD invite network error:', err?.message ?? err)
        return json({
          ok:    true,
          orgId: newOrgId,
          warning: `Program created but the Athletic Director invite to ${email} couldn't be sent. Send it manually from Settings → Coaches & Staff once you switch to the new program.`,
        })
      }
      if (!inviteRes.ok) {
        const text = await inviteRes.text().catch(() => '')
        console.error('[add-program] AD invite failed:', inviteRes.status, text)
        let inviteErr = `Invite failed (${inviteRes.status})`
        try { inviteErr = JSON.parse(text)?.msg ?? JSON.parse(text)?.message ?? inviteErr } catch {}
        return json({
          ok:    true,
          orgId: newOrgId,
          warning: `Program created but the AD invite to ${email} failed: ${inviteErr}. Send it manually from Settings → Coaches & Staff.`,
        })
      }
      invitedAdEmail = email
    }
  }

  return json({ ok: true, orgId: newOrgId, promotedToAd, invitedAdEmail })
}
