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
    // Modern email-link flow: the email points directly at this page with
    //   ?token_hash=<hash>&type=invite
    // We exchange the hash for a session via verifyOtp INSIDE the user's
    // browser (a POST), so Gmail's link-safety prefetcher can't consume the
    // token by GET'ing the URL ahead of the user. verifyOtp emits a
    // SIGNED_IN event on success, which the onAuthStateChange handler below
    // picks up. We strip the params from the URL afterwards so a reload
    // doesn't try to re-use a consumed token.
    const params     = new URLSearchParams(window.location.search)
    const token_hash = params.get('token_hash')
    const otpType    = params.get('type')
    if (token_hash) {
      console.log('[AcceptInvite] verifyOtp start, type=', otpType ?? 'invite')
      supabase.auth.verifyOtp({
        type:       otpType ?? 'invite',
        token_hash,
      }).then(({ data, error }) => {
        if (error) {
          console.error('[AcceptInvite] verifyOtp error:', error.message)
          setAuthLoading(false)
          setAuthError(
            'Your invite link has already been used or expired. ' +
            'Ask your head coach or athletic director to send a fresh invite.'
          )
        } else {
          console.log('[AcceptInvite] verifyOtp ok, session userId=', data?.session?.user?.id ?? null)
          // Strip token_hash + type from the URL — leaves /invite clean.
          window.history.replaceState({}, '', window.location.pathname)
        }
      })
    }

    // The Supabase client also processes any legacy hash-fragment tokens
    // from the URL automatically (older invites still in flight). We listen
    // for the resulting SIGNED_IN / INITIAL_SESSION event regardless of
    // which path produced the session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AcceptInvite] onAuthStateChange', event, 'userId=', session?.user?.id ?? null)
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
          setAuthError('Your invite link has expired or is invalid. Ask your head coach or athletic director to send a new invite.')
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
              setAuthError('Your invite link has expired or is invalid. Ask your head coach or athletic director to send a new invite.')
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
    console.log('[AcceptInvite] handleSetPassword fired',
      { hasAuthUser: !!authUser, authUserId: authUser?.id ?? null,
        passwordSet: passwordSet.current, passwordLen: password.length })

    if (!authUser?.id) {
      console.warn('[AcceptInvite] guard: authUser missing — bailing')
      setSubmitErr('Session lost — reload the invite link from your email.')
      return
    }
    // First-attempt validation only (after password is set we skip this on retry).
    if (!passwordSet.current && (!password || password.length < 8)) {
      console.warn('[AcceptInvite] guard: password too short')
      setSubmitErr('Password must be at least 8 characters.')
      return
    }
    console.log('[AcceptInvite] state → submitting=true')
    setSubmitting(true); setSubmitErr('')
    console.log('[AcceptInvite] entering try block')

    try {
      // Step 1: set the password (skipped on retry once password is set).
      if (!passwordSet.current) {
        console.log('[AcceptInvite] state → stage="saving-password"')
        setStage('saving-password')

        // Preflight: confirm the auth client actually has a session it can
        // attach to PUT /user. The token_hash flow has previously emitted
        // SIGNED_IN, but if the session got nuked between then and now (lock
        // contention, token expiry, etc) the call would never even reach
        // the server. We need to see this in the logs either way.
        console.log('[AcceptInvite] await supabase.auth.getSession() …')
        const { data: { session: pfSession }, error: pfErr } =
          await supabase.auth.getSession()
        console.log('[AcceptInvite] preflight getSession',
          { hasSession:    !!pfSession,
            sessionUserId: pfSession?.user?.id ?? null,
            error:         pfErr?.message ?? null })
        if (!pfSession) {
          throw new Error('Your invite session expired. Reload the invite link from your email.')
        }

        const updates = { password }
        if (fullName.trim()) updates.data = { full_name: fullName.trim() }

        // ── Why we don't `await supabase.auth.updateUser(...)` ──────────────
        // updateUser's Promise resolves only after _notifyAllSubscribers
        // finishes Promise.all-ing every onAuthStateChange callback. The
        // AuthProvider in src/context/AuthContext.jsx awaits a PostgREST
        // fetchProfile() with no timeout when USER_UPDATED fires, and on
        // the post-invite path that await never settles — even though the
        // PUT /user request has already succeeded server-side.
        //
        // We sidestep that by listening for USER_UPDATED directly and
        // awaiting the proof event with a 10s timeout. updateUser is
        // fire-and-forget — its rejection (if any) is logged but does not
        // block the flow.
        let cleanupListener = () => {}
        const passwordSaved = new Promise(resolve => {
          const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'USER_UPDATED') {
              console.log('[AcceptInvite] USER_UPDATED received — password saved')
              subscription.unsubscribe()
              resolve()
            }
          })
          cleanupListener = () => subscription.unsubscribe()
        })

        console.log('[AcceptInvite] calling supabase.auth.updateUser (fire-and-forget)')
        supabase.auth.updateUser(updates).catch(err => {
          console.error('[AcceptInvite] updateUser threw:', err?.message ?? err)
        })

        console.log('[AcceptInvite] await Promise.race([passwordSaved, 10s timeout]) …')
        try {
          await Promise.race([
            passwordSaved,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Password save timed out. Please try again.')),
                10000
              )
            ),
          ])
        } finally {
          // Idempotent — safe even if the listener already self-unsubscribed.
          cleanupListener()
        }
        console.log('[AcceptInvite] password save confirmed via USER_UPDATED')
        console.log('[AcceptInvite] state → passwordSet.current=true')
        passwordSet.current = true
      }

      // Step 2: create the profile server-side. This is the RLS-bypass call.
      // If it fails, the password is still set on the auth user, so a retry
      // will skip step 1 and only repeat this.
      console.log('[AcceptInvite] state → stage="creating-profile"')
      setStage('creating-profile')
      console.log('[AcceptInvite] calling /api/accept-invite')
      const apiData = await createProfileServerSide(authUser.id)
      console.log('[AcceptInvite] /api/accept-invite ok', apiData)

      // Step 3: announce success and redirect.
      console.log('[AcceptInvite] state → stage="done", done=true')
      setStage('done')
      setDone(true)
      console.log('[AcceptInvite] hard-reloading to /dashboard in 1500ms')
      // Full page reload required: AuthContext's profile state is stale (null) at this
      // point because its fetchProfile ran before /api/accept-invite created the row.
      // Hard reload forces AuthContext to re-init and pick up the now-existing profile,
      // so ProtectedRoute won't re-route to /onboarding. Mirrors the signOut pattern
      // in AuthContext.jsx that uses window.location.replace for the same reason.
      setTimeout(() => window.location.replace('/dashboard'), 1500)
    } catch (err) {
      console.error('[AcceptInvite] handleSetPassword error:', err?.message ?? err)
      setSubmitErr(err.message ?? 'Something went wrong. Please try again.')
      console.log('[AcceptInvite] state → stage="idle" (after error)')
      setStage('idle')
    } finally {
      console.log('[AcceptInvite] state → submitting=false (finally)')
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
