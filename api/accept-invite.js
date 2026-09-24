// Vercel Edge Function — Finalize a coach invite by creating their profile row.
//
// Why this exists:
//   profiles RLS only permits ad/head_coach to INSERT. A freshly-invited
//   coach has no profile row yet, so get_my_role() returns NULL and the
//   browser-side upsert is denied. We bypass RLS with the service role
//   key — same pattern as api/create-account.js for first-time ADs.
//
// ROLES (renamed 2026-05-16 — Commit 2a athletic-terminology refactor):
//   ad / head_coach / assistant_coach / team_manager
//   (formerly owner / admin / coach / readonly)
//
// AUTH REQUIRED + INSERT ONLY (2026-09-24).
//
// This endpoint had no JWT check and took userId from the request body, then
// upserted profiles on that id with the service role. role/org_id were never
// forgeable (they come from the auth user's metadata, not the body), but the
// upsert could still REWRITE an existing profile back to its original invite
// state — and the auth metadata drifts away from the DB over time:
//
//   • A removed coach: removal hard-deletes profiles (and cascades
//     coach_orgs), but leaves the auth user and user_metadata intact. Calling
//     this endpoint rebuilt both rows — self-reinstatement after removal.
//   • A demoted coach: an AD's demotion writes profiles.role only, so
//     user_metadata.role still holds the ORIGINAL invited role. Re-running
//     wrote that stale role back, silently undoing the demotion.
//
// prevent_self_role_change did not mitigate either: this runs as the service
// role, where auth.uid() is NULL, so the trigger passes straight through.
//
// TWO changes, and the second is the one that actually closes it:
//   1. The caller's identity comes from a verified JWT. The body is ignored.
//      (The invited coach already has a real session by this point —
//      AcceptInvite.jsx calls supabase.auth.verifyOtp() first, which consumes
//      the invite token and mints a session. Requiring a JWT breaks nothing.)
//   2. INSERT ONLY. A removed coach still holds a valid session, so auth alone
//      would not stop them: they would pass the JWT check and reinstate
//      themselves exactly as before. This endpoint may now only CREATE a
//      profile. If one already exists it is never modified — org_id and role
//      belong to the AD, not to a stale invite.
//
// Re-runs stay safe: an identical re-run is a 200 no-op (AcceptInvite.jsx
// retries this call by design), and only a re-run that WOULD have changed
// org_id or role returns 409.
//
// Only genuinely new users reach here. An invite to an email that already has
// an account is handled entirely inside api/invite-coach.js, which adds the
// coach_orgs row server-side and sends no invite email — so insert-only cannot
// break the multi-program flow.
//
// Inputs (request body): none are trusted. userId, if sent, is ignored.
//
// org_id, role, full_name and email are pulled from the trusted server-side
// auth user record so the client can't forge a privilege escalation.
//
// REQUIRED ENV VARS (Vercel → Settings → Environment Variables):
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

// Verify the inbound Authorization: Bearer <jwt> header by asking Supabase
// to resolve it to a user. Same shape as api/create-account.js and
// api/invite-coach.js — we trust Supabase to validate signature and expiry
// rather than rolling our own JWT verification at the edge.
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
    console.error('[accept-invite] auth verify network error:', err)
    return { ok: false, status: 502, error: 'Auth verification failed' }
  }
  if (!res.ok) {
    // Malformed tokens come back 400/403 and expired ones 401; all are the
    // caller's problem. 502 is reserved for genuine upstream failure.
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

// Returns the existing profile row, or null. Drives the insert-only decision.
async function loadExistingProfile(supabaseUrl, serviceKey, userId) {
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,org_id,role&limit=1`
  const res = await fetch(url, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  })
  if (!res.ok) throw new Error(`profile lookup HTTP ${res.status}`)
  const rows = await res.json()
  return (Array.isArray(rows) ? rows[0] : null) ?? null
}

function sbHeaders(serviceKey) {
  return {
    'Content-Type':  'application/json',
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Prefer':        'return=representation',
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('[accept-invite] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  // The body is read but nothing in it is trusted. userId used to come from
  // here; it now comes from the verified session below. An empty body is fine.
  try { await req.json() } catch { /* body is optional and ignored */ }

  const authCheck = await verifyCallerJwt(req, supabaseUrl, serviceKey)
  if (!authCheck.ok) return json({ error: authCheck.error }, authCheck.status)
  const userId = authCheck.userId

  try {
    // 1. Fetch the auth user via service-role admin API. Trusted source for
    //    org_id / role / full_name / email — never trust the client to pass
    //    these because the metadata was set by the inviter (an admin/owner).
    const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    })
    if (!userRes.ok) {
      const text = await userRes.text().catch(() => '')
      console.error('[accept-invite] auth admin lookup failed:', userRes.status, text)
      if (userRes.status === 404) return json({ error: 'Invited user not found.' }, 404)
      return json({ error: 'Could not load invited user record.' }, 502)
    }
    const authUser = await userRes.json()
    const meta = authUser?.user_metadata ?? {}

    const org_id    = meta.org_id
    const role      = meta.role      ?? 'assistant_coach'
    const full_name = meta.full_name ?? ''
    const email     = authUser?.email ?? ''

    if (!org_id) {
      // Either the invite predates this flow, or the inviter wasn't using
      // our /api/invite-coach endpoint. Tell the user clearly so support
      // can re-send the invite via the UI.
      return json({
        error: 'This invite is missing organization details. Ask your head coach or athletic director to send a fresh invite from PracticePace.',
      }, 400)
    }

    // 2. Resolve account_id directly from the organization row.
    //    organizations.account_id IS the authoritative source for which
    //    account the invitee joins — every org is created with a valid
    //    account_id (api/create-account.js for first-time signup,
    //    api/add-program.js for additional programs on existing
    //    accounts), and the column is FK-constrained to public.accounts.
    //
    //    Why not via the org's AD profile (the previous strategy)?
    //      • ADs are account-scoped, not org-scoped. A newly-created
    //        program has zero profiles pinned to its org_id (the AD's
    //        profile.org_id stays at their home org). The previous
    //        `profiles WHERE org_id = X AND role = 'ad'` query returned
    //        nothing for Girls Basketball-style invites and the
    //        endpoint died.
    //      • The drift risk the earlier comment cited (an upgrade
    //        creating a new accounts row while organizations.account_id
    //        stayed pointing at the old one) was an artifact of the
    //        pre-Commit-2b single-program model. The current
    //        Add-Program flow doesn't introduce drift — orgs always
    //        carry the correct account_id at creation, and we verified
    //        there's no drift in the live DB before flipping this.
    const orgRes = await fetch(
      `${supabaseUrl}/rest/v1/organizations?id=eq.${encodeURIComponent(org_id)}&select=account_id&limit=1`,
      { headers: sbHeaders(serviceKey) }
    )
    if (!orgRes.ok) {
      const text = await orgRes.text().catch(() => '')
      console.error('[accept-invite] org lookup failed:', orgRes.status, text)
      return json({ error: 'Could not look up your program.' }, 502)
    }
    const orgs = await orgRes.json()
    const orgRow = Array.isArray(orgs) ? orgs[0] : null
    if (!orgRow || !orgRow.account_id) {
      console.error('[accept-invite] no organization (or no account_id) for org_id', org_id)
      return json({
        error: `This invite points at a program (${org_id}) we can't find. Ask your head coach or athletic director to send a fresh invite.`,
      }, 404)
    }
    const account_id = orgRow.account_id

    // 3. INSERT ONLY — never modify an existing profile.
    //
    // This is the change that actually closes the exploit. Requiring a JWT is
    // not enough on its own: a coach who was removed still holds a valid
    // session, so they would pass the auth check and the old upsert would
    // happily rebuild their profile from stale user_metadata. org_id and role
    // on an existing profile belong to the AD who set them, and an invite
    // record — which can be months stale — must never overwrite them.
    let existing
    try {
      existing = await loadExistingProfile(supabaseUrl, serviceKey, userId)
    } catch (err) {
      console.error('[accept-invite] profile lookup failed:', err?.message ?? err)
      return json({ error: 'Could not verify your account state. Please try again.' }, 502)
    }

    if (existing) {
      // AcceptInvite.jsx retries this call by design (a failed run re-runs and
      // skips the password step), so an identical re-run must stay a success.
      const sameOrg  = String(existing.org_id) === String(org_id)
      const sameRole = String(existing.role)   === String(role)
      if (sameOrg && sameRole) {
        console.log('[accept-invite] profile already present and identical — no-op:', { userId, org_id, role })
        return json({ ok: true, profile: existing, unchanged: true })
      }

      // A re-run that WOULD have changed something. Refuse and change nothing.
      // This is the removed/demoted-coach path: their invite metadata disagrees
      // with the DB precisely because an AD changed it deliberately.
      console.warn('[accept-invite] refusing to modify existing profile:', {
        userId,
        existing: { org_id: existing.org_id, role: existing.role },
        invite:   { org_id, role },
      })
      return json({
        error: 'Your account already exists and is set up by your program. This invite link can\'t change it — ask your head coach or athletic director if something looks wrong.',
      }, 409)
    }

    // Genuinely new user: create the profile. Plain INSERT, no on_conflict —
    // if a row appeared between the lookup and here, the PK conflict is a
    // legitimate 409 rather than something to merge over.
    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles`,
      {
        method:  'POST',
        headers: sbHeaders(serviceKey),
        body: JSON.stringify({
          id:         userId,
          account_id,
          org_id,
          email,
          full_name,
          role,
        }),
      }
    )
    if (!insertRes.ok) {
      const text = await insertRes.text().catch(() => '')
      // 23505 = unique_violation: another request created it concurrently.
      if (insertRes.status === 409 || text.includes('23505')) {
        console.warn('[accept-invite] concurrent profile creation for', userId)
        return json({ error: 'Your account was just set up — please reload.' }, 409)
      }
      console.error('[accept-invite] profile insert failed:', insertRes.status, text)
      return json({ error: `Could not create your profile (${insertRes.status}). Please try again.` }, 500)
    }
    const rows = await insertRes.json().catch(() => null)
    const profile = Array.isArray(rows) ? rows[0] : rows

    // 4. Commit D: also create the matching coach_orgs row so new invites
    //    are consistent with Commit A's model going forward.
    //
    //    INSERT-ONLY APPLIES HERE TOO, structurally rather than by another
    //    check: this line is only reachable when the profile insert above just
    //    succeeded, because the "profile already exists" branch returns before
    //    it (200 no-op or 409). So this endpoint can no longer recreate a
    //    coach_orgs row for an established coach — which matters because
    //    coach_orgs.profile_id is ON DELETE CASCADE from profiles, so removing
    //    a coach drops their membership too, and rebuilding it here was the
    //    self-reinstatement path.
    //
    //    A deliberately deleted membership for a coach who still HAS a profile
    //    is therefore never resurrected. Re-adding them is the AD's job, via
    //    api/invite-coach.js.
    //
    //    ignore-duplicates is kept as belt-and-braces; on this path the row
    //    cannot already exist (the cascade removed it with the profile).
    //    Non-fatal: profiles (the row that actually gates login/dashboard
    //    access) is already committed at this point. A missing coach_orgs
    //    row just means this org won't show up in the future switcher —
    //    log and continue rather than blocking account creation over it.
    const coachOrgRes = await fetch(
      `${supabaseUrl}/rest/v1/coach_orgs?on_conflict=profile_id,org_id`,
      {
        method:  'POST',
        headers: {
          ...sbHeaders(serviceKey),
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ profile_id: userId, org_id, role }),
      }
    )
    if (!coachOrgRes.ok) {
      const text = await coachOrgRes.text().catch(() => '')
      console.error('[accept-invite] coach_orgs insert failed (non-fatal):', coachOrgRes.status, text)
    }

    console.log('[accept-invite] profile ready:', { userId, org_id, account_id, role })
    return json({ ok: true, profile })
  } catch (err) {
    console.error('[accept-invite] error:', err?.message ?? err)
    return json({ error: err?.message ?? 'Profile setup failed.' }, 500)
  }
}
