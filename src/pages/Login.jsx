import { useState }   from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase }    from '../lib/supabase'
import Logo    from '../components/Logo'
import Tagline from '../components/Tagline'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('signin') // 'signin' | 'create'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Race any promise against a 10 s timeout — rejects with a typed error on timeout
  function withTimeout(promise, ms = 10_000) {
    const clock = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('__TIMEOUT__')), ms)
    )
    return Promise.race([promise, clock])
  }

  // Map raw Supabase / network errors to friendly messages
  function friendlyError(err) {
    const msg = err?.message ?? ''
    if (msg === '__TIMEOUT__')
      return 'Connection timed out — check your internet connection and try again.'
    if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('network'))
      return 'No internet connection — please check your network and try again.'
    if (msg.toLowerCase().includes('invalid login credentials') || msg.toLowerCase().includes('invalid credentials'))
      return 'Incorrect email or password.'
    if (msg.toLowerCase().includes('email not confirmed'))
      return 'Please confirm your email address before signing in.'
    if (msg.toLowerCase().includes('too many requests'))
      return 'Too many attempts — please wait a moment and try again.'
    return msg || 'Something went wrong. Please try again.'
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')

    // Fail fast if env vars are missing (common in fresh Vercel deployments)
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      setError('App is not configured — missing environment variables. Contact support.')
      console.error('[Login] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set.')
      return
    }

    setLoading(true)

    try {
      if (mode === 'create') {
        console.log('[Login] Attempting sign up for', email)
        const { error: signUpError } = await withTimeout(
          supabase.auth.signUp({ email, password })
        )
        if (signUpError) throw signUpError
        console.log('[Login] Sign up succeeded — awaiting email confirmation')
        setInfo('Check your email to confirm your account, then sign in.')
        setMode('signin')
        return
      }

      console.log('[Login] Attempting sign in for', email)
      const { data, error: signInError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password })
      )
      console.log('[Login] signInWithPassword result:', { userId: data?.user?.id, error: signInError?.message })
      if (signInError) throw signInError

      console.log('[Login] Checking profiles table for user', data.user.id)
      const { data: profile, error: profileError } = await withTimeout(
        supabase.from('profiles').select('id').eq('id', data.user.id).maybeSingle()
      )
      console.log('[Login] Profile check result:', { hasProfile: !!profile, error: profileError?.message })

      navigate(profile ? '/dashboard' : '/onboarding')
    } catch (err) {
      console.error('[Login] Auth error:', err.message)
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword() {
    setError('')
    setInfo('')

    if (!email.trim()) {
      setError('Enter your email first')
      return
    }

    setLoading(true)
    try {
      const { error: resetErr } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: 'https://www.practicepace.app/reset-password',
        })
      )
      if (resetErr) throw resetErr
      setInfo('Password reset email sent. Check your inbox.')
    } catch (err) {
      console.error('[Login] Reset password error:', err.message)
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleGuest() {
    setError('')
    setLoading(true)

    try {
      console.log('[Login] Attempting anonymous sign in')
      const { error: guestError } = await withTimeout(
        supabase.auth.signInAnonymously()
      )
      if (guestError) throw guestError
      console.log('[Login] Anonymous sign in succeeded')
      navigate('/dashboard')
    } catch (err) {
      console.error('[Login] Guest error:', err.message)
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: '#080000' }}
    >
      {/* Logo + tagline — above the card */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <Logo variant="white" height={48} />
        <Tagline />
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm md:max-w-md rounded-2xl px-8 py-10 flex flex-col items-center gap-6"
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
      >

        {/* Mode toggle */}
        <div
          className="flex w-full rounded-lg overflow-hidden text-sm font-semibold"
          style={{ border: '1px solid #2a0000' }}
        >
          <button
            type="button"
            onClick={() => { setMode('signin'); setError(''); setInfo('') }}
            className="flex-1 py-2 transition-colors"
            style={{
              backgroundColor: mode === 'signin' ? '#cc1111' : 'transparent',
              color: mode === 'signin' ? '#fff' : '#9a8080',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('create'); setError(''); setInfo('') }}
            className="flex-1 py-2 transition-colors"
            style={{
              backgroundColor: mode === 'create' ? '#cc1111' : 'transparent',
              color: mode === 'create' ? '#fff' : '#9a8080',
            }}
          >
            Create Account
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#9a8080' }}>
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="coach@team.com"
              className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-all"
              style={{
                backgroundColor: '#1a0000',
                border: '1px solid #2a0000',
                color: '#ffffff',
                caretColor: '#cc1111',
              }}
              onFocus={e => (e.target.style.borderColor = '#cc1111')}
              onBlur={e => (e.target.style.borderColor = '#2a0000')}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#9a8080' }}>
              Password
            </label>
            <input
              type="password"
              required
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-all"
              style={{
                backgroundColor: '#1a0000',
                border: '1px solid #2a0000',
                color: '#ffffff',
                caretColor: '#cc1111',
              }}
              onFocus={e => (e.target.style.borderColor = '#cc1111')}
              onBlur={e => (e.target.style.borderColor = '#2a0000')}
            />
          </div>

          {/* Error / info */}
          {error && (
            <p className="text-sm text-center rounded-lg px-3 py-2" style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
              {error}
            </p>
          )}
          {info && (
            <p className="text-sm text-center rounded-lg px-3 py-2" style={{ backgroundColor: '#001a00', color: '#66cc66' }}>
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-semibold text-white text-sm tracking-wide transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#cc1111' }}
          >
            {loading ? 'Loading…' : mode === 'create' ? 'Create Account' : 'Sign In'}
          </button>

          {mode === 'signin' && (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              className="text-xs underline transition-colors disabled:opacity-50"
              style={{ color: '#9a8080' }}
              onMouseEnter={e => (e.target.style.color = '#cc1111')}
              onMouseLeave={e => (e.target.style.color = '#9a8080')}
            >
              Forgot password?
            </button>
          )}
        </form>

        {/* Divider */}
        <div className="w-full flex items-center gap-3">
          <div className="flex-1 h-px" style={{ backgroundColor: '#2a0000' }} />
          <span className="text-xs" style={{ color: '#4a2020' }}>or</span>
          <div className="flex-1 h-px" style={{ backgroundColor: '#2a0000' }} />
        </div>

        {/* Guest */}
        <button
          type="button"
          onClick={handleGuest}
          disabled={loading}
          className="text-sm transition-colors disabled:opacity-50"
          style={{ color: '#9a8080' }}
          onMouseEnter={e => (e.target.style.color = '#cc1111')}
          onMouseLeave={e => (e.target.style.color = '#9a8080')}
        >
          Continue as guest →
        </button>
      </div>
    </div>
  )
}
