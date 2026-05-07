// Vercel Edge Function — Supabase coach invite
// Calls auth.admin.inviteUserByEmail() server-side so the service role key
// never touches the browser.
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl     = process.env.VITE_SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[invite-coach] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

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

  // ── Call Supabase Admin invite endpoint ────────────────────────────────────
  // POST /auth/v1/invite  (requires service role key)
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
          role:      role      ?? 'coach',
          full_name: name?.trim() ?? '',
        },
        // Coach lands here after clicking the email link. www domain matches
        // the Site URL the rest of the app uses (password reset, login flow);
        // must be in Supabase → Auth → URL Configuration → Redirect URLs.
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
