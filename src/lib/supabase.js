import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[Supabase] Missing environment variables!\n' +
    '  VITE_SUPABASE_URL:', supabaseUrl ? '✓' : '✗ MISSING', '\n' +
    '  VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✓' : '✗ MISSING', '\n' +
    'Add these in Vercel → Project → Settings → Environment Variables, then redeploy.'
  )
}

// flowType: 'pkce' is recommended for SPAs and is required by the new
// email-link pattern (token_hash + verifyOtp on the receiving page) we use
// for invites and password resets. The default in @supabase/auth-js 2.x is
// 'implicit', which produces emails that hit /auth/v1/verify on first GET —
// Gmail's link-safety prefetcher eats those tokens before the user clicks.
//
// In-memory `lock` overrides supabase-js's default `navigatorLock`. The
// default uses navigator.locks for cross-tab session sharing, but on the
// invite flow that produced a hang inside `await supabase.auth.updateUser`
// — verifyOtp emits SIGNED_IN/USER_UPDATED notifications inline, the
// notification handlers re-enter auth state, and the cross-tab lock would
// not release on time, so the awaited promise never settled despite the
// PUT /user request actually succeeding server-side. We don't rely on
// cross-tab session sharing in production (the app is a single-tab iPad
// PWA), so the memory lock is the right tradeoff. Same shape as
// supabase-js's internal `lockNoOp`: just call the work fn directly.
const memoryLock = (_name, _acquireTimeout, fn) => fn()

export const supabase = createClient(
  supabaseUrl     ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  {
    auth: {
      flowType:           'pkce',
      lock:               memoryLock,
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
  }
)
