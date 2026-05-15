// Vercel Edge Function — create a Stripe Billing Portal Session
// Lets coaches manage their subscription, update payment method, or cancel.
//
// REQUIRED ENV VARS:
//   STRIPE_SECRET_KEY
//
// Request body: { customerId }
// Response:     { url }

export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    console.error('[stripe-portal] Missing STRIPE_SECRET_KEY')
    return json({ error: 'Server misconfigured — contact support.' }, 500)
  }

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }

  const { customerId } = body
  if (!customerId) return json({ error: 'customerId is required' }, 400)

  try {
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer:   customerId,
        return_url: 'https://practicepace.app/dashboard',
      }).toString(),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message ?? `Stripe error ${res.status}`)

    return json({ url: data.url })
  } catch (err) {
    // Log the raw error server-side for diagnostics; return a generic
    // message to the client so we don't leak Stripe internals or DB
    // schema text. See the audit report for the rationale.
    console.error('[stripe-portal] error:', err?.message ?? err)
    return json({ error: 'Unable to open billing portal. Please try again.' }, 500)
  }
}
