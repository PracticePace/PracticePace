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
// Inputs (request body):
//   { userId }   — the auth.users id of the invited coach (required)
//
// Everything else (org_id, role, full_name, email) is pulled from the
// trusted server-side auth user record so the client can't forge a
// privilege escalation by lying about role / org_id.
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

  let body
  try { body = await req.json() } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const { userId } = body
  if (!userId) return json({ error: 'userId is required' }, 400)

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

    // 3. Upsert the profile row. ON CONFLICT (id) makes this idempotent —
    //    safe to retry from the client without creating duplicates.
    const upsertRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?on_conflict=id`,
      {
        method:  'POST',
        headers: {
          ...sbHeaders(serviceKey),
          'Prefer': 'resolution=merge-duplicates,return=representation',
        },
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
    if (!upsertRes.ok) {
      const text = await upsertRes.text().catch(() => '')
      console.error('[accept-invite] profile upsert failed:', upsertRes.status, text)
      return json({ error: `Could not create your profile (${upsertRes.status}). Please try again.` }, 500)
    }
    const rows = await upsertRes.json().catch(() => null)
    const profile = Array.isArray(rows) ? rows[0] : rows

    console.log('[accept-invite] profile ready:', { userId, org_id, account_id, role })
    return json({ ok: true, profile })
  } catch (err) {
    console.error('[accept-invite] error:', err?.message ?? err)
    return json({ error: err?.message ?? 'Profile setup failed.' }, 500)
  }
}
