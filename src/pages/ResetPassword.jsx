// ── ResetPassword ─────────────────────────────────────────────────────────────
// Coaches land here after clicking the "reset password" link in the email
// sent by supabase.auth.resetPasswordForEmail().
//
// Flow:
//   1. Coach clicks the link in the email → Supabase redirects to
//      https://www.practicepace.app/reset-password with a recovery token
//      in the URL hash.
//   2. The Supabase JS client picks up the token automatically and emits
//      'PASSWORD_RECOVERY' (or sets a session) via onAuthStateChange.
//   3. We show a "set new password" form.
//   4. On submit, we call supabase.auth.updateUser({ password }).
//   5. Redirect to /dashboard.
//
// SUPABASE SETUP (one-time):
//   Auth → URL Configuration → Redirect URLs → add:
//     https://www.practicepace.app/reset-password
//     https://practicepace.app/reset-password

import { useState, useEffect } from 'react'
import { useNavigate }          from 'react-router-dom'
import { supabase }              from '../lib/supabase'
import Logo                      from '../components/Logo'

export default function ResetPassword() {
  const navigate = useNavigate()

  const [ready,      setReady]      = useState(false)   // recovery session detected
  const [authError,  setAuthError]  = useState('')
  const [password,   setPassword]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr,  setSubmitErr]  = useState('')
  const [done,       setDone]       = useState(false)

  // ── Detect recovery session from URL ───────────────────────────────────────
  useEffect(() => {
    // The Supabase client processes recovery tokens from the URL automatically.
    // We listen for the resulting PASSWORD_RECOVERY (or SIGNED_IN) event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
          setReady(true)
        }
      }
    )

    // Also check for an existing session (e.g. page reload on this route)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setReady(true)
      } else {
        // Give onAuthStateChange a moment to fire before declaring failure.
        setTimeout(() => {
          setReady(prev => {
            if (!prev) {
              setAuthError('This password reset link is invalid or has expired. Request a new one from the sign-in page.')
            }
            return prev
          })
        }, 4000)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!password || password.length < 8) {
      setSubmitErr('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true); setSubmitErr('')

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw new Error(error.message)
      setDone(true)
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
    } catch (err) {
      setSubmitErr(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    backgroundColor: '#1a0000',
    border:          '1px solid #2a0000',
    color:           '#fff',
  }

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
        {/* ── Loading (waiting for token exchange) ── */}
        {!ready && !authError && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">Verifying reset link…</h1>
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
        {authError && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">Link not valid</h1>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <p className="text-sm leading-relaxed" style={{ color: '#ff8888' }}>{authError}</p>
              <button
                onClick={() => navigate('/')}
                className="py-3 rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: '#cc1111' }}
              >
                Back to Sign In
              </button>
            </div>
          </>
        )}

        {/* ── Done ── */}
        {ready && done && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">Password updated</h1>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4 items-center">
              <div className="text-5xl">✓</div>
              <p className="text-sm text-center" style={{ color: '#66cc88' }}>
                Taking you to the dashboard…
              </p>
            </div>
          </>
        )}

        {/* ── Set password form ── */}
        {ready && !done && (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #2a0000' }}>
              <h1 className="font-black text-white text-xl">Set a new password</h1>
              <p className="text-xs mt-1" style={{ color: '#9a8080' }}>
                Choose a new password to sign in with from now on.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: '#9a8080' }}>
                  New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoFocus
                  autoComplete="new-password"
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
                {submitting ? 'Saving…' : 'Update Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
