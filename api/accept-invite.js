// Vercel Edge Function — Finalize a coach invite by creating their profile row.
//
// Why this exists:
//   profiles RLS only permits owners/admins to INSERT. A freshly-invited
//   coach has no profile row yet, so get_my_role() returns NULL and the
//   browser-side upsert is denied. We bypass RLS with the service role
//   key — same pattern as api/create-account.js for first-time owners.
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
    const role      = meta.role      ?? 'coach'
    const full_name = meta.full_name ?? ''
    const email     = authUser?.email ?? ''

    if (!org_id) {
      // Either the invite predates this flow, or the inviter wasn't using
      // our /api/invite-coach endpoint. Tell the user clearly so support
      // can re-send the invite via the UI.
      return json({
        error: 'This invite is missing organization details. Ask your admin to send a fresh invite from PracticePace.',
      }, 400)
    }

    // 2. Resolve account_id from the org's OWNER profile, NOT from
    //    organizations.account_id directly. Reason: organizations.account_id
    //    can drift when an account is upgraded/replaced (e.g. owner moves
    //    from a single-program trial to a school plan; a new accounts row is
    //    created and the owner's profile gets repointed at it, but
    //    organizations.account_id can be left pointing at the obsolete row).
    //    The owner's profile is the live source of truth for which account
    //    the invitee should join — RLS uses get_my_account_id() (which reads
    //    profiles.account_id) for org-membership SELECTs, so anchoring the
    //    coach's account_id to the owner's keeps them visible to each other.
    const ownerRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?org_id=eq.${encodeURIComponent(org_id)}&role=eq.owner&select=account_id&limit=1`,
      { headers: sbHeaders(serviceKey) }
    )
    if (!ownerRes.ok) {
      const text = await ownerRes.text().catch(() => '')
      console.error('[accept-invite] owner lookup failed:', ownerRes.status, text)
      return json({ error: 'Could not look up your program.' }, 502)
    }
    const owners = await ownerRes.json()
    if (!Array.isArray(owners) || owners.length === 0) {
      console.error('[accept-invite] no owner profile found for org', org_id)
      return json({
        error: `Cannot determine account for invite: no owner profile found for org ${org_id}. Ask your admin to send a fresh invite.`,
      }, 404)
    }
    const account_id = owners[0].account_id

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
