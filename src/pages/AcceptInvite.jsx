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
  const [done,       setDone]       = useState(false)

  const profileCreated = useRef(false)  // guard against double-create

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
            await ensureProfile(u)
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
        ensureProfile(session.user)
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

  // ── Create profile row from invite metadata ────────────────────────────────
  async function ensureProfile(user) {
    if (profileCreated.current) return
    profileCreated.current = true

    const meta   = user.user_metadata ?? {}
    const org_id = meta.org_id
    const role   = meta.role   ?? 'coach'
    const name   = meta.full_name ?? ''

    if (!org_id) {
      // Metadata missing — invite wasn't sent via our Edge Function.
      // Still let them in; they can be linked to an org by an admin later.
      console.warn('[AcceptInvite] No org_id in user metadata — profile not linked to org')
      return
    }

    const { error } = await supabase.from('profiles').upsert({
      id:        user.id,
      org_id,
      email:     user.email ?? '',
      full_name: name,
      role,
    }, { onConflict: 'id' })

    if (error) {
      console.error('[AcceptInvite] profile upsert error:', error.message)
    }
  }

  // ── Set password + finish ──────────────────────────────────────────────────
  async function handleSetPassword(e) {
    e.preventDefault()
    if (!password || password.length < 8) {
      setSubmitErr('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true); setSubmitErr('')

    try {
      const updates = { password }
      if (fullName.trim()) updates.data = { full_name: fullName.trim() }

      const { error } = await supabase.auth.updateUser(updates)
      if (error) throw new Error(error.message)

      // Also keep profile full_name in sync if the user edited it
      if (fullName.trim() && authUser) {
        await supabase
          .from('profiles')
          .update({ full_name: fullName.trim() })
          .eq('id', authUser.id)
      }

      setDone(true)
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
    } catch (err) {
      setSubmitErr(err.message ?? 'Something went wrong. Please try again.')
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

              {submitErr && (
                <p className="text-xs rounded-lg px-3 py-2"
                  style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                  {submitErr}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || !password}
                className="py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#cc1111' }}
              >
                {submitting ? 'Saving…' : 'Set Password & Enter App'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
