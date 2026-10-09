// Contact page — /contact (Boostr rebuild Commit 5, final marketing commit).
//
// Structure (top-to-bottom):
//   • MarketingHeader
//   • Hero — full-bleed cheer scene photo with dark overlay and
//     centered CONTACT headline (mirrors AboutPage hero pattern)
//   • Form — centered, black bg, red eyebrow + "WE'RE HERE TO HELP"
//     headline + subtitle + 5-field form + always-visible fallback
//     email address
//   • ReadyToMaximize
//   • MarketingFooter
//
// Delivery is POST /api/contact, which sends through Resend.
//
// It used to be a mailto: link. On a school Chromebook with no mail client
// configured — which is most of them — assigning window.location to a mailto:
// URL does nothing at all: no error, no mail app, and the page cheerfully
// showed "Opening your email client" while nothing opened. Every message sent
// from a school computer was lost without either side knowing. The fallback
// address stays visible regardless.
//
// Header / CTA / Footer inline per the Commits 1-4 per-page pattern
// (no Outlet layout exists in App.jsx).

import { useState } from 'react'
import MarketingHeader  from '../components/marketing/MarketingHeader'
import MarketingFooter  from '../components/marketing/MarketingFooter'
import ReadyToMaximize  from '../components/marketing/ReadyToMaximize'

// Support inbox — the visible fallback. The server has its own copy; this
// one is only ever rendered, never used to address anything.
const SUPPORT_EMAIL = 'practicepace@gmail.com'

// Basic RFC-5321-ish email shape check. Deliberately loose — we're
// not trying to validate deliverability, just to catch obvious typos
// like a missing @ before we hand the address to the mail client.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Initial form state. Also used to reset the form after a successful
// submission when the user clicks "Send another message".
const EMPTY_FORM = {
  firstName: '',
  lastName:  '',
  email:     '',
  phone:     '',
  message:   '',
  // Honeypot. Off-screen, unlabelled, tabindex -1, autocomplete off — a
  // person never fills it and a form-filling bot usually does. The server
  // drops any submission that has it set, and answers 200 so the bot learns
  // nothing.
  company:   '',
}

function validate(form) {
  const errs = {}
  if (!form.firstName.trim()) errs.firstName = 'First name is required.'
  if (!form.lastName.trim())  errs.lastName  = 'Last name is required.'
  if (!form.email.trim())     errs.email     = 'Email is required.'
  else if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Please enter a valid email address.'
  if (!form.message.trim())   errs.message   = 'Message is required.'
  return errs
}

export default function ContactPage() {
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [errors,    setErrors]    = useState({})
  const [sent,      setSent]      = useState(false)
  const [sending,   setSending]   = useState(false)
  const [sendError, setSendError] = useState('')

  function handleChange(field) {
    return e => {
      const value = e.target.value
      setForm(prev => ({ ...prev, [field]: value }))
      // Clear the field's own error as soon as the user starts
      // editing it — matches the spec's "errors clear when user
      // starts typing in the field" behavior.
      if (errors[field]) {
        setErrors(prev => {
          const next = { ...prev }
          delete next[field]
          return next
        })
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate(form)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    setSendError('')
    setSending(true)

    try {
      const res = await fetch('/api/contact', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName:  form.lastName.trim(),
          email:     form.email.trim(),
          phone:     form.phone.trim(),
          message:   form.message.trim(),
          company:   form.company,
        }),
      })
      const data = await res.json().catch(() => ({}))
      // The success screen appears on a 200 and nothing else. The old version
      // showed it unconditionally, which is how a Chromebook user got a
      // confirmation for a message that was never sent.
      if (!res.ok) throw new Error(data.error ?? '')
      setSent(true)
    } catch (err) {
      console.error('[Contact] send failed:', err?.message ?? err)
      setSendError(err?.message || 'Something went wrong sending your message.')
    } finally {
      setSending(false)
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setErrors({})
    setSendError('')
    setSent(false)
  }

  return (
    <div style={{ backgroundColor: '#000000', color: '#ffffff', minHeight: '100vh' }}>
      <MarketingHeader />

      {/* ───────────── SECTION 1 — HERO ───────────── */}
      <section
        className="relative flex items-center justify-center overflow-hidden"
        style={{ minHeight: 'min(80vh, 900px)' }}
      >
        <img
          src="/marketing/practice-cheer-3.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
          decoding="async"
          aria-hidden="true"
        />
        {/* Dark overlay — 0.6 alpha, same as AboutPage hero so the
            two heroes read as a matched pair. */}
        <div
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          aria-hidden="true"
        />
        <h1
          className="relative font-display uppercase text-white leading-none tracking-wide text-center px-6"
          style={{
            fontSize:   'clamp(4.5rem, 15vw, 12rem)',
            textShadow: '0 8px 40px rgba(0,0,0,0.55)',
          }}
        >
          Contact
        </h1>
      </section>

      {/* ───────────── SECTION 2 — CONTACT FORM ───────────── */}
      <section className="bg-black py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-6 flex flex-col items-center">
          {/* Header block — eyebrow + headline + subtitle. Centered
              even though the form itself is left-aligned by nature. */}
          <span
            className="font-display uppercase text-brand-red text-center"
            style={{ fontSize: '0.9rem', letterSpacing: '0.18em' }}
          >
            Contact Us
          </span>
          <h2
            className="font-display uppercase text-white leading-none tracking-wide text-center mt-4"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)' }}
          >
            We&rsquo;re Here to Help
          </h2>
          <p
            className="font-body text-white text-center mt-6"
            style={{
              fontSize:  'clamp(1rem, 1.4vw, 1.15rem)',
              lineHeight: 1.6,
              maxWidth:  '600px',
            }}
          >
            Have a question, need a demo or want to learn more about Practice:Pace?
            Reach out to our team below. We&rsquo;d love to hear from you!
          </p>

          {/* Form / success swap. Both branches keep the fallback
              email visible at the bottom so users always have a
              working escape hatch. */}
          <div className="w-full mt-10">
            {sent ? (
              <SuccessBlock onReset={resetForm} />
            ) : (
              <ContactForm
                form={form}
                errors={errors}
                onChange={handleChange}
                onSubmit={handleSubmit}
                sending={sending}
                sendError={sendError}
              />
            )}
          </div>

          {/* Always-visible fallback address. Shown BELOW the form
              in the pre-submit state, and BELOW the success message
              in the post-submit state — either way the user can
              copy-paste it if mailto: didn't work for them. */}
          <p
            className="font-body text-center mt-10"
            style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}
          >
            Prefer to email us directly?{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-brand-red transition-opacity hover:opacity-80"
              style={{ textDecoration: 'underline' }}
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </section>

      <ReadyToMaximize />
      <MarketingFooter />
    </div>
  )
}

// ── Form ────────────────────────────────────────────────────────────────────
// Extracted so the render logic stays readable. Fields use `htmlFor`/`id`
// pairs for accessible labeling; required fields carry aria-required and
// their error <p> uses role="alert" per spec.
function ContactForm({ form, errors, onChange, onSubmit, sending, sendError }) {
  return (
    <form onSubmit={onSubmit} noValidate className="w-full flex flex-col gap-5">
      {/* Honeypot. Positioned off-screen rather than display:none — some bots
          skip hidden inputs but fill positioned ones. aria-hidden and
          tabindex -1 keep it away from screen readers and the tab order. */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}
      >
        <label htmlFor="company">Company</label>
        <input
          id="company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.company}
          onChange={onChange('company')}
        />
      </div>

      {/* Row 1 — First / Last name */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field
          id="firstName"
          label="First Name"
          required
          value={form.firstName}
          onChange={onChange('firstName')}
          error={errors.firstName}
          autoComplete="given-name"
        />
        <Field
          id="lastName"
          label="Last Name"
          required
          value={form.lastName}
          onChange={onChange('lastName')}
          error={errors.lastName}
          autoComplete="family-name"
        />
      </div>

      {/* Row 2 — Email / Phone */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field
          id="email"
          label="Email Address"
          type="email"
          required
          value={form.email}
          onChange={onChange('email')}
          error={errors.email}
          autoComplete="email"
        />
        <Field
          id="phone"
          label="Phone Number"
          type="tel"
          value={form.phone}
          onChange={onChange('phone')}
          error={errors.phone}
          autoComplete="tel"
        />
      </div>

      {/* Row 3 — Message textarea (full width) */}
      <Field
        id="message"
        label="Message"
        required
        textarea
        rows={6}
        value={form.message}
        onChange={onChange('message')}
        error={errors.message}
      />

      {/* Submit — brand-red-marketing, full width, Barlow Condensed
          (font-button) to match the GET STARTED button in the header. */}
      {/* Send failure. Always names the address so the message isn't lost
          just because our endpoint is having a bad day. */}
      {sendError && (
        <p
          role="alert"
          className="font-body rounded-md"
          style={{
            backgroundColor: 'rgba(223,31,38,0.12)',
            border:          '1px solid var(--color-brand-red)',
            color:           '#ffffff',
            padding:         '12px 14px',
            fontSize:        '0.95rem',
            lineHeight:      1.5,
          }}
        >
          {sendError} Please email us directly at{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-brand-red"
            style={{ textDecoration: 'underline' }}
          >
            {SUPPORT_EMAIL}
          </a>.
        </p>
      )}

      <button
        type="submit"
        disabled={sending}
        className="font-button uppercase text-white transition-opacity hover:opacity-90 mt-2 disabled:opacity-60"
        style={{
          backgroundColor: 'var(--color-brand-red)',
          padding:         '14px 24px',
          fontSize:        '1.05rem',
          letterSpacing:   '0.08em',
          borderRadius:    '4px',
          width:           '100%',
        }}
      >
        {sending ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  )
}

// ── Success state ───────────────────────────────────────────────────────────
// Shown ONLY after /api/contact returns 200. It used to appear the instant
// the mailto: was assigned, whether or not anything happened.
function SuccessBlock({ onReset }) {
  return (
    <div className="w-full flex flex-col items-center text-center gap-4 py-4">
      <h3
        className="font-display uppercase text-brand-red leading-none tracking-wide"
        style={{ fontSize: 'clamp(2rem, 4.5vw, 2.75rem)' }}
      >
        Message Sent
      </h3>
      <p
        className="font-body text-white"
        style={{ fontSize: '1rem', lineHeight: 1.6, maxWidth: '520px' }}
      >
        Thanks for reaching out — we&rsquo;ll get back to you at the email
        address you gave us. You can also reach us any time at{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-brand-red transition-opacity hover:opacity-80"
          style={{ textDecoration: 'underline' }}
        >
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      <button
        type="button"
        onClick={onReset}
        className="font-body text-white transition-opacity hover:opacity-70 mt-2"
        style={{
          fontSize:       '0.9rem',
          textDecoration: 'underline',
          background:     'transparent',
          border:         'none',
          cursor:         'pointer',
        }}
      >
        Send another message
      </button>
    </div>
  )
}

// ── Field ───────────────────────────────────────────────────────────────────
// Shared label + input/textarea + error line. `error` toggles the
// border color to brand-red and renders a role="alert" line below.
function Field({
  id, label, required, textarea, rows, type = 'text',
  value, onChange, error, autoComplete,
}) {
  const hasError = Boolean(error)
  // Base + focus + error-state styles. Border is styled inline so
  // the focus color change reads even in browsers that skip the
  // Tailwind focus utility set in production.
  const controlBaseClass =
    'w-full font-body rounded-md transition-colors ' +
    'placeholder:text-neutral-500 focus:outline-none'
  const controlStyle = {
    backgroundColor: '#0a0a0a',
    color:           '#ffffff',
    border:          hasError
      ? '1px solid var(--color-brand-red)'
      : '1px solid #404040',
    padding:         '12px 14px',
    fontSize:        '1rem',
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="font-display uppercase text-white"
        style={{ fontSize: '0.85rem', letterSpacing: '0.1em' }}
      >
        {label}{required ? ' *' : ''}
      </label>
      {textarea ? (
        <textarea
          id={id}
          name={id}
          rows={rows || 5}
          value={value}
          onChange={onChange}
          aria-required={required || undefined}
          aria-invalid={hasError || undefined}
          className={controlBaseClass}
          style={{ ...controlStyle, resize: 'vertical', minHeight: '140px' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand-red)' }}
          onBlur={e  => {
            e.currentTarget.style.borderColor = hasError ? 'var(--color-brand-red)' : '#404040'
          }}
        />
      ) : (
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          aria-required={required || undefined}
          aria-invalid={hasError || undefined}
          className={controlBaseClass}
          style={controlStyle}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand-red)' }}
          onBlur={e  => {
            e.currentTarget.style.borderColor = hasError ? 'var(--color-brand-red)' : '#404040'
          }}
        />
      )}
      {hasError && (
        <p
          role="alert"
          className="font-body"
          style={{ color: '#f87171', fontSize: '0.85rem', marginTop: '2px' }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
