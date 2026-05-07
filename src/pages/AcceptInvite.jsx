// ── AcceptInvite ──────────────────────────────────────────────────────────────
// Coaches land here after clicking the Supabase invite email link.
//
// Flow:
//   1. Supabase sends invite email via auth.admin.inviteUserByEmail()
//   2. Coach clicks link → Supabase redirects to https://practicepace.app/invite
//      with auth tokens in the URL (hash or query params depending on flow type)
//   3. The Supabase JS client auto-detects and processes those tokens
//   4. onAuthStateChange fires with event 'SIGNED_IN'
//   5. We read user_metadata (org_id, role, full_name set at invite time)
//   6. Upsert their profile row in the profiles table
//   7. Ask them to set a password (they were invited without one)
//   8. Navigate to /dashboard
//
// SUPABASE SETUP (one-time):
//   Auth → URL Configuration → Redirect URLs → add: https://practicepace.app/invite

import { useState, useEffect, useRef } from 'react'
import { useNavigate }                  from 'react-router-dom'
import { supabase }                     from '../lib/supabase'
import Logo                             from '../components/Logo'
import PasswordInput                    from '../components/PasswordInput'

export default function AcceptInvite() {
  const navigate = useNavigate()

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [authUser,    setAuthUser]    = useState(null)   // supabase user object
  const [authLoading, setAuthLoading] = useState(true)   // waiting for tokens to process
  const [authError,   setAuthError]   = useState('')     // no session / expired

  // ── Profile create + password set ─────────────────────────────────────────
  const [fullName,   setFullName]   = useState('')
  const [password,   setPassword]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr,  setSubmitErr]  = useState('')
  // Stages: 'idle' | 'saving-password' | 'creating-profile' | 'done'
  const [stage,      setStage]      = useState('idle')
  const [done,       setDone]       = useState(false)
  // Once the password is set we don't want a retry to update it again.
  const passwordSet = useRef(false)

  // ── Detect session from invite link ────────────────────────────────────────
  useEffect(() => {
    // The Supabase client processes auth tokens from the URL automatically.
    // We listen for the resulting SIGNED_IN / INITIAL_SESSION event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          if (session?.user) {
            const u = session.user
            setAuthUser(u)
            setFullName(u.user_metadata?.full_name ?? '')
            setAuthLoading(false)
            // We no longer create the profile here — it's done server-side
            // (via /api/accept-invite, which uses service_role to bypass
            // profiles RLS) AFTER the user sets their password.
          }
        } else if (event === 'SIGNED_OUT') {
          setAuthLoading(false)
          setAuthError('Your invite link has expired or is invalid. Ask your admin to send a new invite.')
        }
      }
    )

    // Also check for an existing session (page reload after partial completion)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setAuthUser(session.user)
        setFullName(session.user.user_metadata?.full_name ?? '')
        setAuthLoading(false)
      } else {
        // Give onAuthStateChange a moment to fire before declaring failure.
        // If the URL has tokens, the client needs ~500ms to exchange them.
        setTimeout(() => {
          setAuthLoading(prev => {
            if (prev) {
              // Still loading after grace period — no valid session found
              setAuthError('Your invite link has expired or is invalid. Ask your admin to send a new invite.')
              return false
            }
            return prev
          })
        }, 4000)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Server-side profile creation (bypasses profiles RLS) ───────────────────
  async function createProfileServerSide(userId) {
    const res = await fetch('/api/accept-invite', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error ?? `Profile setup failed (${res.status}).`)
    }
    return data
  }

  // ── Set password + create profile + finish ─────────────────────────────────
  async function handleSetPassword(e) {
    e.preventDefault()
    if (!authUser?.id) {
      setSubmitErr('Session lost — reload the invite link from your email.')
      return
    }
    // First-attempt validation only (after password is set we skip this on retry).
    if (!passwordSet.current && (!password || password.length < 8)) {
      setSubmitErr('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true); setSubmitErr('')

    try {
      // Step 1: set the password (skipped on retry once password is set).
      if (!passwordSet.current) {
        setStage('saving-password')
        const updates = { password }
        if (fullName.trim()) updates.data = { full_name: fullName.trim() }
        const { error: pwErr } = await supabase.auth.updateUser(updates)
        if (pwErr) throw new Error(pwErr.message)
        passwordSet.current = true
      }

      // Step 2: create the profile server-side. This is the new RLS-bypass
      // call. If it fails, the password is still set on the auth user, so
      // a retry will skip step 1 and only repeat this.
      setStage('creating-profile')
      await createProfileServerSide(authUser.id)

      // Step 3: announce success and redirect.
      setStage('done')
      setDone(true)
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
    } catch (err) {
      setSubmitErr(err.message ?? 'Something went wrong. Please try again.')
      setStage('idle')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const meta    = authUser?.user_metadata ?? {}
  const orgId   = meta.org_id
  // We don't have the org name in metadata — just show a warm generic message.
  // If you want the org name, fetch it from Supabase once the user is authed.

  const inputStyle = {
    backgroundColor: '#1a0000',
    border:          '1px solid #2a0000',
    color:           '#fff',
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 gap-6"
      style={{ backgroundColor: '#080000' }}
    >
      <Logo variant="white" height={44} />

      <div
        className="w-full max-w-sm rounded-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
      >
        {/* ── Loading ── */}
        {authLoading && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">Setting up your account…</h1>
              <p className="text-xs mt-1" style={{ color: '#9a8080' }}>Verifying your invite link</p>
            </div>
            <div className="px-6 py-10 flex items-center justify-center">
              <div
                className="w-8 h-8 rounded-full border-2 animate-spin"
                style={{ borderColor: '#cc1111', borderTopColor: 'transparent' }}
              />
            </div>
          </>
        )}

        {/* ── Error ── */}
        {!authLoading && authError && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">Invite Not Found</h1>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <p className="text-sm leading-relaxed" style={{ color: '#ff8888' }}>{authError}</p>
              <button
                onClick={() => navigate('/')}
                className="py-3 rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: '#cc1111' }}
              >
                Go to Sign In
              </button>
            </div>
          </>
        )}

        {/* ── Done ── */}
        {!authLoading && !authError && done && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">You're all set!</h1>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4 items-center">
              <div className="text-5xl">✓</div>
              <p className="text-sm text-center" style={{ color: '#66cc88' }}>
                Account created. Taking you to the dashboard…
              </p>
            </div>
          </>
        )}

        {/* ── Set password form ── */}
        {!authLoading && !authError && !done && authUser && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">Welcome to PracticePace!</h1>
              <p className="text-xs mt-1" style={{ color: '#9a8080' }}>
                Set a password to complete your account setup
              </p>
            </div>

            <form onSubmit={handleSetPassword} className="px-6 py-5 flex flex-col gap-4">
              {/* Full name — editable in case invite had no name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: '#9a8080' }}>
                  Your Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Coach Smith"
                  className="rounded-lg px-4 py-3 text-sm outline-none"
                  style={inputStyle}
                />
              </div>

              {/* Email — read-only from invite */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: '#9a8080' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={authUser.email ?? ''}
                  readOnly
                  className="rounded-lg px-4 py-3 text-sm outline-none opacity-60 cursor-default"
                  style={inputStyle}
                />
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: '#9a8080' }}>
                  Create Password
                </label>
                <PasswordInput
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoFocus
                  className="rounded-lg px-4 py-3 text-sm outline-none"
                  style={inputStyle}
                />
              </div>

              {/* Inline loading state for the post-password "creating profile"
                  step so the user always sees what's happening. */}
              {submitting && stage === 'creating-profile' && (
                <p className="text-xs rounded-lg px-3 py-2 flex items-center gap-2"
                  style={{ backgroundColor: '#0d0800', color: '#9a8080', border: '1px solid #2a0000' }}>
                  <span className="inline-block w-3 h-3 rounded-full border-2 animate-spin shrink-0"
                    style={{ borderColor: '#cc1111', borderTopColor: 'transparent' }} />
                  Setting up your account…
                </p>
              )}

              {submitErr && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs rounded-lg px-3 py-2"
                    style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                    {submitErr}
                  </p>
                  <p className="text-xs" style={{ color: '#9a8080' }}>
                    Need help? Email{' '}
                    <a href="mailto:practicepace@gmail.com" className="underline" style={{ color: '#cc1111' }}>
                      practicepace@gmail.com
                    </a>
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || (!passwordSet.current && !password)}
                className="py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#cc1111' }}
              >
                {submitting && stage === 'saving-password'   ? 'Saving password…'
                : submitting && stage === 'creating-profile' ? 'Setting up your account…'
                : submitErr && passwordSet.current           ? 'Try Again'
                : 'Set Password & Enter App'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
