// ── AuthCallback — /auth/callback ─────────────────────────────────────────────
// The single landing point for every link we email. It establishes a session
// if it can, then forwards to wherever the link was meant to go.
//
// THE BUG THIS FIXES
// supabase.auth.signUp() passed no emailRedirectTo, so the confirmation link
// used the project's Site URL and dropped the coach on the marketing home
// page: no session, no message, nothing to click. Worse in the common case —
// sign up on a laptop, open the email on a phone — where the PKCE ?code=
// cannot be exchanged at all, because the code_verifier lives in the original
// browser's localStorage. The coach is genuinely confirmed server-side at that
// point; they just can't be signed in here. That deserves a sentence, not a
// marketing page.
//
// FOUR INPUTS, IN PRIORITY ORDER
//   1. error / error_description  — Supabase appends these (query OR hash) for
//      an expired or already-used link. Shown as "expired or already used",
//      with resend.
//   2. token_hash + type          — the prefetch-safe pattern. For /invite and
//      /reset-password these are FORWARDED untouched, because those pages run
//      their own verifyOtp for reasons documented in authRedirects.js.
//      Otherwise exchanged here.
//   3. code                       — PKCE. Exchanged here; failure is the
//      cross-device case and gets the "confirmed, log in" screen.
//   4. an existing session        — a reload, or the client already picked up
//      a hash fragment. Just route.
//
// NOTHING RAW EVER REACHES THE SCREEN. Supabase error strings are logged and
// replaced with one of two written messages.

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SAFE_NEXT_PATHS, SELF_EXCHANGING_PATHS, SIGNUP_REDIRECT } from '../lib/authRedirects'
import Logo from '../components/Logo'

// Supabase puts errors in the query string on some flows and the hash fragment
// on others. Read both; the query wins on a tie.
function readParams() {
  const search = new URLSearchParams(window.location.search)
  const hash   = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const get    = k => search.get(k) ?? hash.get(k)
  return {
    code:        get('code'),
    tokenHash:   get('token_hash'),
    type:        get('type'),
    error:       get('error') ?? get('error_code'),
    errorDesc:   get('error_description'),
    next:        search.get('next'),
  }
}

// Only ever forward to a path we published. Anything else is dropped —
// an open redirect on an auth callback is a phishing link wearing our domain.
function safeNext(next) {
  if (!next) return null
  if (!next.startsWith('/') || next.startsWith('//')) return null
  return SAFE_NEXT_PATHS.has(next) ? next : null
}

// Where a confirmed user belongs, mirroring the same decision Login.jsx makes
// after a password sign-in. Raced against a timeout: a stalled PostgREST must
// not leave the coach on a spinner forever. On timeout we send them to
// /dashboard and let ProtectedRoute sort it out — it already redirects a
// profile-less user onward.
async function destinationForUser(userId) {
  const lookup = supabase
    .from('profiles').select('id').eq('id', userId).maybeSingle()
    .then(({ data }) => (data ? '/dashboard' : '/onboarding'))
    .catch(() => '/dashboard')
  const timeout = new Promise(resolve => setTimeout(() => resolve('/dashboard'), 4000))
  return Promise.race([lookup, timeout])
}

export default function AuthCallback() {
  const navigate = useNavigate()
  // 'working' | 'confirmed' (session couldn't be made here) | 'expired'
  const [screen, setScreen] = useState('working')
  // StrictMode double-invokes effects in dev; a token may only be spent once.
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    ;(async () => {
      const { code, tokenHash, type, error, errorDesc, next } = readParams()
      const target = safeNext(next)

      // ── 1. Supabase told us the link is dead ──────────────────────────────
      if (error) {
        console.warn('[AuthCallback] link error:', error, errorDesc ?? '')
        setScreen('expired')
        return
      }

      // ── 2. token_hash — forward to pages that exchange it themselves ──────
      if (tokenHash && target && SELF_EXCHANGING_PATHS.has(target)) {
        const fwd = new URLSearchParams({ token_hash: tokenHash, type: type ?? '' })
        navigate(`${target}?${fwd.toString()}`, { replace: true })
        return
      }

      // ── 2b. token_hash with nowhere special to go — exchange it here ──────
      if (tokenHash) {
        const { data, error: otpErr } = await supabase.auth.verifyOtp({
          type: type ?? 'signup', token_hash: tokenHash,
        })
        if (otpErr) {
          console.warn('[AuthCallback] verifyOtp failed:', otpErr.message)
          setScreen('expired')
          return
        }
        const uid = data?.session?.user?.id
        navigate(target ?? (uid ? await destinationForUser(uid) : '/dashboard'), { replace: true })
        return
      }

      // ── 3. PKCE code ──────────────────────────────────────────────────────
      if (code) {
        const { data, error: exErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exErr) {
          // Almost always the cross-device case: no code_verifier in THIS
          // browser. The account is confirmed regardless — the verify step
          // already ran server-side before Supabase redirected us here. So
          // this is not an error to apologise for, it's a sign-in prompt.
          console.warn('[AuthCallback] code exchange failed:', exErr.message)
          setScreen('confirmed')
          return
        }
        const uid = data?.session?.user?.id
        if (target) { navigate(target, { replace: true }); return }
        navigate(uid ? await destinationForUser(uid) : '/dashboard', { replace: true })
        return
      }

      // ── 4. Already signed in (reload, or a hash the client picked up) ─────
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        navigate(target ?? await destinationForUser(session.user.id), { replace: true })
        return
      }

      // ── Nothing to work with ──────────────────────────────────────────────
      setScreen('confirmed')
    })()
  }, [navigate])

  if (screen === 'working') return <Shell><Spinner /></Shell>

  return screen === 'expired'
    ? <ExpiredScreen />
    : <ConfirmedScreen />
}

// ── Screens ──────────────────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-6"
      style={{ backgroundColor: '#080000' }}>
      <Logo variant="default" height={40} />
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <>
      <div
        className="rounded-full animate-spin"
        style={{
          width: 32, height: 32,
          border: '3px solid #2a0000', borderTopColor: '#cc1111',
        }}
        role="status"
        aria-label="Signing you in"
      />
      <p className="text-sm" style={{ color: '#9a8080' }}>Signing you in…</p>
    </>
  )
}

function Button({ onClick, children, variant = 'solid', disabled }) {
  const solid = variant === 'solid'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-3.5 rounded-xl text-sm font-black transition-all active:scale-95 disabled:opacity-60"
      style={{
        backgroundColor: solid ? '#cc1111' : 'transparent',
        border:          solid ? 'none' : '2px solid #2a0000',
        color:           solid ? '#fff' : '#9a8080',
        boxShadow:       solid ? '0 4px 20px #cc111144' : 'none',
      }}
    >
      {children}
    </button>
  )
}

// The cross-device / no-verifier case. The account IS confirmed — Supabase
// verified it before redirecting here — so this says so plainly and asks for
// the one thing still missing.
function ConfirmedScreen() {
  const navigate = useNavigate()
  return (
    <Shell>
      <div className="flex flex-col gap-3 max-w-sm">
        <h1 className="text-2xl font-black text-white">Your email is confirmed.</h1>
        <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
          Log in to continue. If you opened this link on a different device from
          the one you signed up on, that&rsquo;s expected — your account is ready.
        </p>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <Button onClick={() => navigate('/login')}>Log in</Button>
      </div>
    </Shell>
  )
}

// Expired or already-used. Offers the two things that actually help.
function ExpiredScreen() {
  const navigate = useNavigate()
  const [email,   setEmail]   = useState('')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [problem, setProblem] = useState('')

  async function resend() {
    if (!email.trim()) { setProblem('Enter your email address first.'); return }
    setProblem(''); setSending(true)
    try {
      const { error } = await supabase.auth.resend({
        type:    'signup',
        email:   email.trim(),
        options: { emailRedirectTo: SIGNUP_REDIRECT },
      })
      // Deliberately not surfaced differently: telling a stranger whether an
      // address has a pending confirmation is an account-enumeration oracle.
      if (error) console.warn('[AuthCallback] resend failed:', error.message)
      setSent(true)
    } catch (err) {
      console.warn('[AuthCallback] resend threw:', err?.message ?? err)
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <Shell>
      <div className="flex flex-col gap-3 max-w-sm">
        <h1 className="text-2xl font-black text-white">This link has expired or was already used.</h1>
        <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
          Email links are single-use and time-limited. Log in if your account is
          already set up, or send yourself a fresh confirmation email.
        </p>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3">
        <Button onClick={() => navigate('/login')}>Log in</Button>

        {sent ? (
          <p className="text-sm leading-relaxed" style={{ color: '#66cc88' }}>
            If that address needs confirming, a new email is on its way.
          </p>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@school.edu"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                backgroundColor: '#110000',
                border: '1px solid #2a0000',
                color: '#fff',
              }}
            />
            <Button onClick={resend} variant="ghost" disabled={sending}>
              {sending ? 'Sending…' : 'Resend confirmation email'}
            </Button>
          </>
        )}

        {problem && (
          <p className="text-xs" style={{ color: '#ff6666' }}>{problem}</p>
        )}
      </div>
    </Shell>
  )
}
