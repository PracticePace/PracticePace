// Vercel Serverless Function (Node.js runtime) — Stripe webhook handler
//
// MUST be Node.js (not Edge) so we can stream the raw body for HMAC verification.
// bodyParser: false tells Vercel NOT to pre-parse the body.
//
// REQUIRED ENV VARS (set in Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   VITE_SUPABASE_URL        (same key re-used from the frontend)
//   SUPABASE_SERVICE_ROLE_KEY
//
// Supabase table used: accounts
//   columns: id (matches org_id / accountId from Stripe metadata),
//            stripe_customer_id, stripe_subscription_id,
//            status ('trialing'|'active'|'past_due'|'canceled'),
//            trial_ends_at

import crypto from 'crypto'

export const config = { api: { bodyParser: false } }

// ── Stripe signature verification ────────────────────────────────────────────
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing stripe-signature header')

  const parts      = sigHeader.split(',')
  const timestamp  = parts.find(p => p.startsWith('t='))?.slice(2)
  const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3))

  if (!timestamp || signatures.length === 0) {
    throw new Error('Invalid stripe-signature format')
  }

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    throw new Error('Webhook timestamp too old — possible replay attack')
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  const match = signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
    } catch {
      return false
    }
  })

  if (!match) throw new Error('Webhook signature mismatch')
}

// ── Supabase REST helpers (service role — bypasses RLS) ──────────────────────
function sbHeaders(serviceKey) {
  return {
    'Content-Type':  'application/json',
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
  }
}

async function sbSelect(table, filter, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/${table}?${filter}&select=*`
  console.log('[webhook] sbSelect →', `${table}?${filter}`)
  const res  = await fetch(url, { headers: sbHeaders(serviceKey) })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase SELECT failed (${res.status}): ${text}`)
  return JSON.parse(text)
}

async function sbPatch(table, filter, data, supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/${table}?${filter}`
  console.log('[webhook] sbPatch →', `${table}?${filter}`, JSON.stringify(data))
  const res  = await fetch(url, {
    method:  'PATCH',
    headers: { ...sbHeaders(serviceKey), 'Prefer': 'return=representation' },
    body:    JSON.stringify(data),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase PATCH failed (${res.status}): ${text}`)
  return JSON.parse(text)   // array of updated rows
}

async function sbUpsert(table, data, onConflict, supabaseUrl, serviceKey) {
  // on_conflict MUST be in the query string — without it PostgREST does a plain
  // INSERT and silently skips the row if a conflict exists.
  const url = `${supabaseUrl}/rest/v1/${table}?on_conflict=${onConflict}`
  console.log('[webhook] sbUpsert →', `${table}?on_conflict=${onConflict}`, JSON.stringify(data))
  const res  = await fetch(url, {
    method:  'POST',
    headers: {
      ...sbHeaders(serviceKey),
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(data),
  })
  const text = await res.text()
  console.log('[webhook] sbUpsert response status:', res.status, '— body:', text.slice(0, 300))
  if (!res.ok) throw new Error(`Supabase UPSERT failed (${res.status}): ${text}`)
  return JSON.parse(text)
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // ── Log env var presence (values are never logged) ────────────────────────
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const secretKey     = process.env.STRIPE_SECRET_KEY
  const supabaseUrl   = process.env.VITE_SUPABASE_URL
  const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY

  console.log('[webhook] env check:', {
    STRIPE_WEBHOOK_SECRET:     !!webhookSecret,
    STRIPE_SECRET_KEY:         !!secretKey,
    VITE_SUPABASE_URL:         !!supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: !!serviceKey,
  })

  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set — cannot verify signature')
    // Return 200 so Stripe doesn't retry an unconfigured endpoint forever
    res.status(200).json({ received: true, warning: 'webhook secret not configured' })
    return
  }

  // ── Read raw body (required for HMAC signature check) ─────────────────────
  let rawBody
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    rawBody = Buffer.concat(chunks).toString('utf8')
    console.log('[webhook] raw body length:', rawBody.length)
  } catch (err) {
    console.error('[webhook] Failed to read request body:', err.message)
    res.status(400).json({ error: 'Could not read request body' })
    return
  }

  // ── Verify Stripe signature ────────────────────────────────────────────────
  try {
    verifyStripeSignature(rawBody, req.headers['stripe-signature'], webhookSecret)
    console.log('[webhook] Signature verified OK')
  } catch (err) {
    // Log the raw error server-side; return a generic message so a
    // probing attacker can't learn which signature step failed (timestamp
    // skew vs key mismatch vs malformed header, etc.).
    console.error('[webhook] Signature verification failed:', err?.message ?? err)
    res.status(400).json({ error: 'Invalid webhook signature' })
    return
  }

  // ── Parse event ───────────────────────────────────────────────────────────
  let event
  try {
    event = JSON.parse(rawBody)
  } catch (err) {
    console.error('[webhook] Failed to parse event JSON:', err.message)
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  console.log('[webhook] received event:', event.type, event.id)

  // ── From here on: ALWAYS return 200 to Stripe.
  //    DB errors are logged but must not cause Stripe to retry endlessly —
  //    retries won't fix schema mismatches or misconfigured env vars.
  // ──────────────────────────────────────────────────────────────────────────

  if (!supabaseUrl || !serviceKey) {
    console.error('[webhook] Supabase env vars missing — event received but not stored:', event.type)
    res.status(200).json({ received: true, warning: 'supabase not configured' })
    return
  }

  try {
    switch (event.type) {

      // ── New subscriber: trial starts ───────────────────────────────────────
      case 'checkout.session.completed': {
        const session        = event.data.object
        const accountId      = session.metadata?.accountId   // = org_id
        const customerId     = session.customer
        const subscriptionId = session.subscription
        const priceId        = session.metadata?.priceId

        console.log('[webhook] checkout.session.completed:', {
          accountId, customerId, subscriptionId, priceId,
          sessionId:   session.id,
          allMetadata: session.metadata,
        })

        if (!accountId || !customerId || !subscriptionId) {
          console.warn('[webhook] checkout.session.completed: missing required metadata — skipping DB write')
          console.warn('[webhook] Expected session.metadata.accountId to contain the org ID')
          break
        }

        // Fetch the Stripe subscription to get actual status + trial_end.
        // Do NOT hardcode 'trialing' — when skipTrial was true the sub is 'active' immediately.
        let subStatus   = 'trialing'
        let trialEndsAt = null
        if (secretKey) {
          try {
            const subRes  = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
              headers: { 'Authorization': `Bearer ${secretKey}` },
            })
            const subData = await subRes.json()
            subStatus   = subData.status ?? 'trialing'
            trialEndsAt = subData.trial_end
              ? new Date(subData.trial_end * 1000).toISOString()
              : null
            console.log('[webhook] Stripe subscription:', { status: subStatus, trial_end: trialEndsAt })
          } catch (err) {
            console.error('[webhook] Failed to fetch Stripe subscription — defaulting to trialing:', err.message)
          }
        }

        // The accounts row already exists (created during onboarding).
        // PATCH only the Stripe fields — never touch name or other required columns.
        const patch = {
          stripe_customer_id:     customerId,
          stripe_subscription_id: subscriptionId,
          status:                 subStatus,
          trial_ends_at:          trialEndsAt,
        }
        console.log('[webhook] patching account', accountId, JSON.stringify(patch))

        try {
          const rows = await sbPatch('accounts', `id=eq.${accountId}`, patch, supabaseUrl, serviceKey)
          console.log('[webhook] checkout.session.completed: patched account rows:', rows.length, '— accountId:', accountId)
          if (rows.length === 0) {
            console.warn('[webhook] PATCH matched 0 rows — accountId may not exist in accounts table:', accountId)
          }
        } catch (dbErr) {
          console.error('[webhook] DB patch failed for checkout.session.completed:', dbErr.message)
        }
        break
      }

      // ── Subscription status changed (active, past_due, canceled, etc.) ────
      case 'customer.subscription.updated': {
        const sub            = event.data.object
        const customerId     = sub.customer
        const subscriptionId = sub.id
        const status         = sub.status
        const trialEndsAt    = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null

        console.log('[webhook] subscription.updated:', { customerId, subscriptionId, status })

        const patch = {
          stripe_subscription_id: subscriptionId,
          status,
          ...(trialEndsAt !== null && { trial_ends_at: trialEndsAt }),
        }

        try {
          const updated = await sbPatch(
            'accounts',
            `stripe_customer_id=eq.${customerId}`,
            patch,
            supabaseUrl,
            serviceKey
          )
          console.log(`[webhook] subscription.updated: ${customerId} → ${status} (${updated.length} rows updated)`)
        } catch (dbErr) {
          console.error('[webhook] DB patch failed for subscription.updated:', dbErr.message)
        }
        break
      }

      // ── Subscription canceled / deleted ────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub        = event.data.object
        const customerId = sub.customer

        console.log('[webhook] subscription.deleted:', { customerId, subId: sub.id })

        try {
          const updated = await sbPatch(
            'accounts',
            `stripe_customer_id=eq.${customerId}`,
            { status: 'canceled' },
            supabaseUrl,
            serviceKey
          )
          console.log(`[webhook] subscription.deleted: ${customerId} → canceled (${updated.length} rows)`)
        } catch (dbErr) {
          console.error('[webhook] DB patch failed for subscription.deleted:', dbErr.message)
        }
        break
      }

      // ── Payment failed ─────────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice    = event.data.object
        const customerId = invoice.customer

        console.log('[webhook] invoice.payment_failed:', { customerId, invoiceId: invoice.id })

        try {
          const updated = await sbPatch(
            'accounts',
            `stripe_customer_id=eq.${customerId}`,
            { status: 'past_due' },
            supabaseUrl,
            serviceKey
          )
          console.log(`[webhook] invoice.payment_failed: ${customerId} → past_due (${updated.length} rows)`)
        } catch (dbErr) {
          console.error('[webhook] DB patch failed for invoice.payment_failed:', dbErr.message)
        }
        break
      }

      default:
        console.log('[webhook] Unhandled event type (ignored):', event.type)
    }
  } catch (err) {
    // Safety net — still return 200
    console.error('[webhook] Unexpected error processing', event.type, ':', err.message, err.stack)
  }

  // Always acknowledge to Stripe
  res.status(200).json({ received: true })
}
