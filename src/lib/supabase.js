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
export const supabase = createClient(
  supabaseUrl     ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  { auth: { flowType: 'pkce' } }
)
