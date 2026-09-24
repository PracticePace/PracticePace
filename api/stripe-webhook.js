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
// Supabase tables used:
//   accounts — id (matches accountId from Stripe metadata),
//              stripe_customer_id, stripe_subscription_id,
//              status ('trialing'|'active'|'past_due'|'canceled'|'complimentary'),
//              trial_ends_at, price_id
//   stripe_webhook_events — idempotency + ordering (migration 20260924020000)
//
// DURABILITY (2026-09-24). This handler used to return 200 no matter what,
// including when the Supabase write failed. Stripe treats 200 as "delivered"
// and never retries, so a DB blip during checkout.session.completed left a
// charged customer with no access and nothing to replay. The rule now:
//
//   5xx  — a retry could plausibly succeed: Supabase unreachable or erroring,
//          the Stripe subscription fetch failing, required env vars missing,
//          or a 0-row match on an event less than RETRY_WINDOW_MS old (the
//          account row may not exist yet — a real race at signup).
//   200  — a retry cannot help: an event type we don't handle, a replay we
//          have already applied, a stale out-of-order event, missing metadata,
//          or a 0-row match on an event older than the retry window (logged at
//          error level — loud loss beats silent loss).
//   4xx  — the request is malformed: bad signature, unparseable JSON. Stripe
//          does not retry 4xx, which is correct; a bad signature will not
//          become valid.
//
// The 'trialing' fallback when the subscription fetch failed is GONE. Writing
// a guessed status for someone who may have just paid is worse than retrying.

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

// Pull the Stripe Price id off a subscription object. This is the ground
// truth for what a customer actually bought, and the only trustworthy input
// to the program cap — accounts.plan_type can't serve that role because it is
// derived from the org count by add-program/delete-program, and its initial
// value comes from a caller-supplied planType in the unauthenticated
// /api/create-account.
//
// A subscription can carry multiple items; we take the first, which matches
// how api/stripe-checkout.js builds the session (a single line_items[0]).
function priceIdFromSubscription(subData) {
  return subData?.items?.data?.[0]?.price?.id ?? null
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

// ── Durability: retry policy, idempotency, ordering ──────────────────────────

// A 0-row match can mean a genuine race (the webhook beat the account row into
// existence at signup) or a permanently missing account. Retry forever is a
// storm; never retry loses a real payment. Decide on event age: young events
// retry, old ones give up loudly. Stripe does not expose an attempt counter in
// the payload, so age is the available signal.
const RETRY_WINDOW_MS = 60 * 60 * 1000   // 1 hour

// Thrown to signal "return 5xx so Stripe retries".
function retryable(message) {
  const err = new Error(message)
  err.retryable = true
  return err
}

// Stripe's evt_... id is stable across redeliveries, so its presence in the
// log means we have already applied this event.
async function alreadyProcessed(eventId, supabaseUrl, serviceKey) {
  const rows = await sbSelect(
    'stripe_webhook_events',
    `event_id=eq.${encodeURIComponent(eventId)}`,
    supabaseUrl, serviceKey,
  )
  return Array.isArray(rows) && rows.length > 0
}

// Ordering is per customer: a stale event for one customer must not be
// suppressed by a newer event for a different one. Events with no customer id
// are never considered stale — there is nothing to compare them against.
async function isStaleEvent(customerId, eventCreatedIso, supabaseUrl, serviceKey) {
  if (!customerId) return false
  const url = `${supabaseUrl}/rest/v1/stripe_webhook_events`
    + `?stripe_customer_id=eq.${encodeURIComponent(customerId)}`
    + '&order=event_created.desc&limit=1&select=event_created'
  const res = await fetch(url, { headers: sbHeaders(serviceKey) })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase ordering lookup failed (${res.status}): ${text}`)
  const rows = JSON.parse(text)
  const newest = Array.isArray(rows) ? rows[0]?.event_created : null
  if (!newest) return false
  return new Date(eventCreatedIso) < new Date(newest)
}

// Recorded only AFTER the accounts write succeeds — see the migration comment.
// Upsert rather than insert so a concurrent duplicate can't 409 us into a
// pointless retry of work that already landed.
async function recordEvent(event, customerId, supabaseUrl, serviceKey) {
  await sbUpsert('stripe_webhook_events', {
    event_id:           event.id,
    event_type:         event.type,
    event_created:      new Date(event.created * 1000).toISOString(),
    stripe_customer_id: customerId ?? null,
  }, 'event_id', supabaseUrl, serviceKey)
}

// Shared handling for "the PATCH matched nothing".
function handleZeroRows(label, event, detail) {
  const ageMs = Date.now() - event.created * 1000
  if (ageMs < RETRY_WINDOW_MS) {
    throw retryable(`${label}: 0 rows matched (${detail}); event is ${Math.round(ageMs / 1000)}s old — retrying`)
  }
  console.error(
    `[webhook] ${label}: 0 rows matched (${detail}) and the event is `
    + `${Math.round(ageMs / 60000)} minutes old — giving up and returning 200. `
    + 'THIS IS A DROPPED BILLING UPDATE; reconcile this account by hand.'
  )
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
    // Was 200 to avoid retry storms on an unconfigured endpoint, but that
    // silently discarded real billing events. Same call as the Supabase env
    // check below: 5xx keeps ~3 days of Stripe retries as the window to fix
    // the config. A forged request costs nothing here — without the secret we
    // process nothing either way.
    console.error('[webhook] STRIPE_WEBHOOK_SECRET is not set — cannot verify signature')
    res.status(503).json({ error: 'Webhook secret not configured' })
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
    // Was 200, which silently discarded the event forever. A config error is
    // not transient, but Stripe retries 5xx for ~3 days — enough of a window
    // to notice and fix rather than lose the billing update outright.
    console.error('[webhook] Supabase env vars missing — refusing to drop event:', event.type)
    res.status(503).json({ error: 'Supabase not configured' })
    return
  }

  // ── Idempotency + ordering gate ───────────────────────────────────────────
  // Both lookups are inside the retryable path: if the log itself is
  // unreachable we must NOT fall through and re-apply blindly.
  const eventCreatedIso = new Date(event.created * 1000).toISOString()
  // session.customer, subscription.customer and invoice.customer all live at
  // the same path, so one expression covers every event type we handle.
  const eventCustomerId = event.data?.object?.customer ?? null

  try {
    if (await alreadyProcessed(event.id, supabaseUrl, serviceKey)) {
      console.log('[webhook] replay of already-processed event — skipping:', event.id, event.type)
      res.status(200).json({ received: true, skipped: 'duplicate' })
      return
    }
    if (await isStaleEvent(eventCustomerId, eventCreatedIso, supabaseUrl, serviceKey)) {
      console.log('[webhook] stale out-of-order event — skipping:', event.id, event.type, eventCreatedIso)
      res.status(200).json({ received: true, skipped: 'stale' })
      return
    }
  } catch (err) {
    console.error('[webhook] idempotency/ordering lookup failed — retrying:', err?.message ?? err)
    res.status(503).json({ error: 'Event log unavailable' })
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
        // The 'trialing' fallback that used to live here is GONE. If this fetch
        // fails we no longer guess a status for someone who may have just paid
        // — we throw, return 5xx, and let Stripe redeliver.
        if (!secretKey) {
          throw retryable('checkout.session.completed: STRIPE_SECRET_KEY missing, cannot read subscription')
        }
        let subStatus, trialEndsAt, livePriceId
        try {
          const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
            headers: { 'Authorization': `Bearer ${secretKey}` },
          })
          if (!subRes.ok) throw new Error(`Stripe subscription fetch HTTP ${subRes.status}`)
          const subData = await subRes.json()
          subStatus   = subData.status
          trialEndsAt = subData.trial_end ? new Date(subData.trial_end * 1000).toISOString() : null
          // Prefer the price on the live subscription over session.metadata.priceId:
          // metadata is whatever the checkout call asked for, the subscription is
          // what Stripe actually created. They agree today, but only one of them
          // stays correct after a plan change.
          livePriceId = priceIdFromSubscription(subData)
          console.log('[webhook] Stripe subscription:', { status: subStatus, trial_end: trialEndsAt, price_id: livePriceId })
        } catch (err) {
          throw retryable(`checkout.session.completed: subscription fetch failed — ${err?.message ?? err}`)
        }
        if (!subStatus) {
          throw retryable('checkout.session.completed: Stripe returned no subscription status')
        }

        // The accounts row already exists (created during onboarding).
        // PATCH only the Stripe fields — never touch name or other required columns.
        const patch = {
          stripe_customer_id:     customerId,
          stripe_subscription_id: subscriptionId,
          status:                 subStatus,
          trial_ends_at:          trialEndsAt,
          // Falls back to the session metadata when the subscription fetch
          // above failed. Omitted entirely if we know neither, so a failed
          // fetch never blanks a price we already had.
          ...((livePriceId ?? priceId) ? { price_id: livePriceId ?? priceId } : {}),
        }
        console.log('[webhook] patching account', accountId, JSON.stringify(patch))

        // No try/catch: a Supabase failure must propagate to a 5xx so Stripe
        // redelivers. Swallowing it here is what let a charged customer end up
        // with no access and nothing to replay.
        const rows = await sbPatch('accounts', `id=eq.${accountId}`, patch, supabaseUrl, serviceKey)
        console.log('[webhook] checkout.session.completed: patched account rows:', rows.length, '— accountId:', accountId)
        if (rows.length === 0) {
          handleZeroRows('checkout.session.completed', event, `accountId=${accountId}`)
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

        // Plan changes (single -> school and back) arrive here, so this is the
        // event that keeps price_id honest over the life of a subscription.
        const updatedPriceId = priceIdFromSubscription(sub)

        const patch = {
          stripe_subscription_id: subscriptionId,
          status,
          ...(trialEndsAt !== null && { trial_ends_at: trialEndsAt }),
          ...(updatedPriceId ? { price_id: updatedPriceId } : {}),
        }

        const updated = await sbPatch(
          'accounts',
          `stripe_customer_id=eq.${customerId}`,
          patch,
          supabaseUrl,
          serviceKey
        )
        console.log(`[webhook] subscription.updated: ${customerId} → ${status} (${updated.length} rows updated)`)
        if (updated.length === 0) {
          handleZeroRows('customer.subscription.updated', event, `stripe_customer_id=${customerId}`)
        }
        break
      }

      // ── Subscription canceled / deleted ────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub        = event.data.object
        const customerId = sub.customer

        console.log('[webhook] subscription.deleted:', { customerId, subId: sub.id })

        const updated = await sbPatch(
          'accounts',
          `stripe_customer_id=eq.${customerId}`,
          { status: 'canceled' },
          supabaseUrl,
          serviceKey
        )
        console.log(`[webhook] subscription.deleted: ${customerId} → canceled (${updated.length} rows)`)
        if (updated.length === 0) {
          handleZeroRows('customer.subscription.deleted', event, `stripe_customer_id=${customerId}`)
        }
        break
      }

      // ── Payment recovered ──────────────────────────────────────────────────
      // Deliberately NARROW: past_due -> active only, via a PostgREST filter on
      // status. It is not a general status writer.
      //
      // Both this and customer.subscription.updated fire on a successful
      // renewal, so an unscoped write here would fight that handler for
      // authority — and worse, a final invoice settling AFTER a cancellation
      // would resurrect 'active' over 'canceled' and hand access back to
      // someone who already left. The status=eq.past_due filter makes this a
      // no-op in every case except the recovery it exists for.
      //
      // It also must not write price_id or stripe_subscription_id: those stay
      // owned by the two subscription events.
      case 'invoice.payment_succeeded': {
        const invoice    = event.data.object
        const customerId = invoice.customer

        console.log('[webhook] invoice.payment_succeeded:', { customerId, invoiceId: invoice.id })

        const updated = await sbPatch(
          'accounts',
          `stripe_customer_id=eq.${customerId}&status=eq.past_due`,
          { status: 'active' },
          supabaseUrl,
          serviceKey
        )
        // 0 rows is the NORMAL case here (the account wasn't past_due), so this
        // never calls handleZeroRows — there is nothing to reconcile.
        console.log(
          updated.length > 0
            ? `[webhook] invoice.payment_succeeded: ${customerId} past_due → active`
            : `[webhook] invoice.payment_succeeded: ${customerId} was not past_due — no change`
        )
        break
      }

      // ── Payment failed ─────────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice    = event.data.object
        const customerId = invoice.customer

        console.log('[webhook] invoice.payment_failed:', { customerId, invoiceId: invoice.id })

        const updated = await sbPatch(
          'accounts',
          `stripe_customer_id=eq.${customerId}`,
          { status: 'past_due' },
          supabaseUrl,
          serviceKey
        )
        console.log(`[webhook] invoice.payment_failed: ${customerId} → past_due (${updated.length} rows)`)
        if (updated.length === 0) {
          handleZeroRows('invoice.payment_failed', event, `stripe_customer_id=${customerId}`)
        }
        break
      }

      default:
        console.log('[webhook] Unhandled event type (ignored):', event.type)
    }
  } catch (err) {
    // A thrown error now means "we could not apply this event". Retryable ones
    // get a 5xx so Stripe redelivers; anything else is an unexpected bug, which
    // we also treat as retryable rather than silently acknowledging a billing
    // update we failed to write.
    console.error('[webhook] failed processing', event.type, event.id, ':', err?.message ?? err)
    if (err?.stack) console.error(err.stack)
    res.status(503).json({ error: 'Event processing failed — please retry' })
    return
  }

  // ── Record the event AFTER the write succeeded ────────────────────────────
  // Order matters: recording first would mean a failed write plus a retry sees
  // "already processed" and skips forever. Recording after can let a concurrent
  // duplicate apply twice, which is harmless — every write above is an
  // idempotent "set column to X".
  //
  // A failure here is NOT retryable: the accounts write already landed, and
  // replaying it would be a no-op anyway. Log and acknowledge, accepting that
  // a redelivery of this same event would re-apply rather than skip.
  try {
    await recordEvent(event, eventCustomerId, supabaseUrl, serviceKey)
  } catch (err) {
    console.error('[webhook] applied event but failed to record it:', event.id, err?.message ?? err)
  }

  res.status(200).json({ received: true })
}
