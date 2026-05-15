import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)   // { id, account_id, org_id, role, full_name, email }
  const [loading, setLoading] = useState(true)

  // Fetch profile for an authenticated non-anonymous user.
  // Never throws — errors are treated as "no profile".
  async function fetchProfile(authUser) {
    if (!authUser || authUser.is_anonymous) {
      setProfile(null)
      return
    }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, account_id, org_id, role, full_name, email')
        .eq('id', authUser.id)
        .maybeSingle()
      setProfile(data ?? null)
    } catch {
      setProfile(null)
    }
  }

  // Race fetchProfile against a 4 s wall-clock timeout. We use this
  // everywhere the auth listener wants to refresh the profile because
  // Supabase's auth client awaits every subscriber's callback Promise.all
  // before resolving auth methods like updateUser(). If fetchProfile
  // hangs (PostgREST stalled on a flaky network, iPad lock-contention,
  // missing profile row mid-onboarding, …), that hang propagates back
  // into the calling code as a userland timeout — the "password save
  // timed out" symptom AcceptInvite used to chase with a workaround.
  // Capping fetchProfile here keeps that contract local to AuthContext.
  async function fetchProfileWithTimeout(authUser) {
    await Promise.race([
      fetchProfile(authUser),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ])
  }

  useEffect(() => {
    // Safety net: force loading=false after 5 s no matter what
    const timeout = setTimeout(() => {
      console.warn('[Auth] Loading timeout — forcing loading=false')
      setLoading(false)
    }, 5000)

    // 1. Restore existing session on mount (sets initial loading state)
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        const authUser = session?.user ?? null
        setUser(authUser)
        // Race fetchProfile against a 4 s timeout — the outer 5 s safety
        // setTimeout still acts as a final guarantee, but capping the
        // await here keeps .finally() prompt and avoids "loading" hanging
        // for the full safety window in the common slow-network case.
        await fetchProfileWithTimeout(authUser)
      })
      .catch(err => {
        console.error('[Auth] getSession error:', err)
      })
      .finally(() => {
        clearTimeout(timeout)
        setLoading(false)
      })

    // 2. React to auth events after mount.
    //
    // SIGNED_IN: set loading=true before fetchProfile so ProtectedRoute waits
    // for the profile before making routing decisions. Without this, the route
    // renders while user is set but profile is still null, which incorrectly
    // triggers the "no profile → /onboarding" redirect.
    //
    // SIGNED_OUT: clear state immediately.
    //
    // Everything else (TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION, etc.):
    // update silently without touching loading.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const authUser = session?.user ?? null

      if (event === 'SIGNED_IN') {
        setLoading(true)
        setUser(authUser)
        // Race fetchProfile against a 4 s timeout so a flaky network on
        // iPad resume can never leave loading=true indefinitely.
        await fetchProfileWithTimeout(authUser)
        setLoading(false)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setProfile(null)
      } else {
        // TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION, PASSWORD_RECOVERY …
        //
        // Same 4 s race as SIGNED_IN. CRITICAL for the post-invite flow:
        // AcceptInvite calls supabase.auth.updateUser(password), which
        // dispatches USER_UPDATED to all subscribers and awaits every
        // callback's Promise.all before resolving. If this fetchProfile
        // call awaits an indefinitely-stalled PostgREST request (which
        // we've seen on iPad resume and on the post-invite path where
        // the profile row doesn't exist yet), the user-facing
        // updateUser() promise hangs and AcceptInvite times out at 10s
        // with "password save timed out". The 4 s cap here unblocks the
        // dispatch path; we simply leave profile=null until the next
        // listener firing if the fetch was still pending. AcceptInvite
        // then creates the profile row server-side and a full-page
        // reload at the end of that flow re-runs AuthContext from
        // scratch, picking up the now-existing row.
        setUser(authUser)
        await fetchProfileWithTimeout(authUser)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    setUser(null)
    setProfile(null)
    await supabase.auth.signOut()
    window.location.replace('/')
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
