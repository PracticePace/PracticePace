// Vercel Edge Function — contact form delivery
//
// REPLACES A mailto: LINK. The contact form used to build a mailto: URL and
// assign window.location to it. On a school Chromebook with no mail client
// configured — which is most of them — that does nothing at all: no error, no
// mail app, just a page that claims "Opening your email client" while nothing
// opens. Every message sent from a school computer was silently lost.
//
// Delivery is Resend's HTTP API rather than SMTP, because the Edge runtime has
// no TCP sockets.
//
// REQUIRED ENV VARS (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY   server-only, never VITE_-prefixed
//
// SENDING DOMAIN: noreply@practicepace.app must be a verified domain in
// Resend (DNS records added) or every send returns 403. The visitor's address
// goes in reply_to, never in `from` — putting it in `from` is a forged sender
// and lands the whole domain in spam.
//
// Request:  POST { firstName, lastName, email, phone?, message, company? }
// Response: { ok: true } | { error }

export const config = { runtime: 'edge' }

const SUPPORT_EMAIL = 'practicepace@gmail.com'
const FROM_ADDRESS  = 'Practice:Pace <noreply@practicepace.app>'

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

// Same loose shape check the form uses client-side. Not deliverability —
// just catching a missing @ before we put it in a reply-to header.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const LIMITS = { name: 100, email: 200, phone: 50, message: 5000 }

// ── Rate limit ───────────────────────────────────────────────────────────────
// In-memory, per instance. An Edge function is not one long-lived process, so
// this is genuinely best-effort: it stops one person hammering submit from a
// warm instance, not a distributed flood. That is the right size of defence
// for a contact form whose worst case is a noisy inbox — a real limiter would
// need shared state, and standing up Redis to protect a mailto: replacement
// is not a trade worth making today. The honeypot below does more work.
const WINDOW_MS   = 10 * 60 * 1000
const MAX_PER_IP  = 5
const hits = new Map()   // ip → number[] (timestamps)

function rateLimited(ip) {
  if (!ip) return false
  const now    = Date.now()
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)

  // Opportunistic sweep so a warm instance can't grow without bound.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every(t => now - t >= WINDOW_MS)) hits.delete(k)
    }
  }
  return recent.length > MAX_PER_IP
}

function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || null
}

// Text going into an HTML email body. Without this a message containing
// "<script>" or stray angle brackets would render as markup in the inbox.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[contact] RESEND_API_KEY is not set — cannot send')
    return json({ error: 'Messages are temporarily unavailable.' }, 503)
  }

  let body
  try { body = await req.json() } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  // ── Honeypot ───────────────────────────────────────────────────────────────
  // `company` is rendered off-screen with no label and tabindex -1, so a human
  // never fills it and a form-filling bot usually does. Answer 200 rather than
  // an error: telling a bot it was detected just teaches it to stop filling
  // the field. As far as the sender can tell, the message went through.
  if (typeof body?.company === 'string' && body.company.trim() !== '') {
    console.warn('[contact] honeypot tripped — dropping silently')
    return json({ ok: true })
  }

  const firstName = String(body?.firstName ?? '').trim()
  const lastName  = String(body?.lastName  ?? '').trim()
  const email     = String(body?.email     ?? '').trim()
  const phone     = String(body?.phone     ?? '').trim()
  const message   = String(body?.message   ?? '').trim()

  if (!firstName || !lastName || !email || !message) {
    return json({ error: 'Please fill in your name, email and message.' }, 400)
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400)
  }
  if (firstName.length > LIMITS.name || lastName.length > LIMITS.name
      || email.length > LIMITS.email || phone.length > LIMITS.phone
      || message.length > LIMITS.message) {
    return json({ error: 'That message is too long — please shorten it.' }, 400)
  }

  if (rateLimited(clientIp(req))) {
    console.warn('[contact] rate limited', clientIp(req))
    return json({ error: "You've sent several messages already. Please try again a little later." }, 429)
  }

  const name = `${firstName} ${lastName}`
  const text =
    `Name: ${name}\n` +
    `Email: ${email}\n` +
    `Phone: ${phone || 'Not provided'}\n\n` +
    `Message:\n${message}`
  const html =
    `<p><strong>Name:</strong> ${esc(name)}<br>`
    + `<strong>Email:</strong> ${esc(email)}<br>`
    + `<strong>Phone:</strong> ${esc(phone || 'Not provided')}</p>`
    + `<p><strong>Message:</strong></p>`
    + `<p style="white-space:pre-wrap">${esc(message)}</p>`

  let res
  try {
    res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     FROM_ADDRESS,
        to:       [SUPPORT_EMAIL],
        // Hitting reply in Gmail answers the coach, not noreply@.
        reply_to: email,
        subject:  `Practice:Pace inquiry from ${name}`,
        text,
        html,
      }),
    })
  } catch (err) {
    console.error('[contact] Resend network error:', err?.message ?? err)
    return json({ error: 'Could not send your message.' }, 502)
  }

  if (!res.ok) {
    // Logged in full server-side; the caller gets nothing specific. A Resend
    // error body can name the account and the sending domain.
    const detail = await res.text().catch(() => '')
    console.error('[contact] Resend HTTP', res.status, detail.slice(0, 300))
    return json({ error: 'Could not send your message.' }, 502)
  }

  console.log('[contact] sent for', email)
  return json({ ok: true })
}
