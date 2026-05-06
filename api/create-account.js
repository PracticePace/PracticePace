// Vercel Edge Function — create account, org, and profile during onboarding.
// Uses the service role key so it bypasses RLS entirely.
//
// REQUIRED ENV VARS:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Request body:
//   { userId, email, fullName, orgName, sport, planType,
//     primaryColor, secondaryColor, schoolName }
//
// Response:
//   { accountId, orgId }

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

  const {
    userId, email, fullName, orgName, sport,
    planType = 'single_program', primaryColor = '#cc1111',
    secondaryColor = '#ffffff', schoolName,
  } = body

  console.log('[create-account] incoming:', {
    userId, email, orgName, sport, planType,
  })

  if (!userId || !email || !orgName || !sport) {
    return json({ error: 'userId, email, orgName, and sport are required' }, 400)
  }

  try {
    // 1. Create account row — trial starts immediately
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const account = await sbInsert(supabaseUrl, serviceKey, 'accounts', {
      name:          orgName,
      // accounts_account_type_check allows 'school' | 'program' only.
      // Anything that isn't an explicit school-wide plan is a single-program account.
      account_type:  planType === 'school' ? 'school' : 'program',
      plan_type:     'monthly',
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

    // 3. Upsert profile — safe to upsert in case a partial row exists
    await sbUpsert(supabaseUrl, serviceKey, 'profiles', {
      id:         userId,
      account_id: account.id,
      org_id:     org.id,
      email,
      role:       'owner',
      full_name:  fullName ?? '',
    }, 'id')
    console.log('[create-account] profile upserted for user:', userId)

    return json({ accountId: account.id, orgId: org.id })
  } catch (err) {
    console.error('[create-account] error:', err.message)
    return json({ error: err.message ?? 'Account creation failed' }, 500)
  }
}
