import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  // { id, account_id, org_id, current_org_id, role, full_name, email, coachOrgs }
  // current_org_id + coachOrgs added in Commit B. Commit C: coachOrgs is
  // now the source of truth for current_org_id validity (see fetchProfile)
  // and per-org role (see useOrg() in OrgContext.jsx). Consumed by the
  // permission gates in Commit C; the switcher UI itself is Commit E.
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Fetch profile for an authenticated non-anonymous user.
  // Never throws — errors are treated as "no profile".
  async function fetchProfile(authUser) {
    if (!authUser || authUser.is_anonymous) {
      setProfile(null)
      return
    }
    try {
      // Run in parallel — coachOrgs failing independently shouldn't take
      // down the whole profile (it's unused groundwork today), so this
      // uses allSettled rather than Promise.all/a single query.
      const [profileResult, coachOrgsResult] = await Promise.allSettled([
        supabase
          .from('profiles')
          .select('id, account_id, org_id, current_org_id, role, full_name, email')
          .eq('id', authUser.id)
          .maybeSingle(),
        supabase
          .from('coach_orgs')
          .select('org_id, role, organizations(name)')
          .eq('profile_id', authUser.id),
      ])

      const data = profileResult.status === 'fulfilled' ? (profileResult.value.data ?? null) : null
      const coachOrgsRows = coachOrgsResult.status === 'fulfilled' ? (coachOrgsResult.value.data ?? []) : []
      const coachOrgs = coachOrgsRows.map(row => ({
        org_id:   row.org_id,
        role:     row.role,
        org_name: row.organizations?.name ?? null,
      }))

      if (!data) {
        setProfile(null)
        return
      }

      // Commit C: coach_orgs is the source of truth for current_org_id
      // validity. If it's null, or points at an org the coach has no
      // coach_orgs membership row for (stale/orphaned pointer), repoint
      // to their first membership and persist the fix. Fire-and-forget —
      // this file's whole design is "never let an extra DB round trip
      // block login" (see fetchProfileWithTimeout below), and a slightly
      // stale current_org_id for one extra render is harmless.
      // If coachOrgs is empty (shouldn't happen post-Commit-A backfill,
      // but defensive), leave current_org_id exactly as fetched — the
      // existing org_id-based fallback chains in Dashboard/OrgContext
      // already handle a null current_org_id safely.
      let currentOrgId = data.current_org_id
      if (coachOrgs.length > 0 && !coachOrgs.some(c => c.org_id === currentOrgId)) {
        currentOrgId = coachOrgs[0].org_id
        supabase
          .from('profiles')
          .update({ current_org_id: currentOrgId })
          .eq('id', authUser.id)
          .then(({ error }) => {
            if (error) console.warn('[Auth] current_org_id repair failed:', error.message)
          })
      }

      setProfile({ ...data, current_org_id: currentOrgId, coachOrgs })
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

  // Commit E: switch which program a multi-program coach is actively
  // viewing. Writes profiles.current_org_id directly (not localStorage —
  // current_org_id is the source of truth get_my_org_id() now reads for
  // RLS, see migration 20260812020000). The DB-level
  // profiles_current_org_id_guard trigger is the actual security
  // boundary; the coachOrgs check here is just a fast, friendly failure
  // before the round trip.
  //
  // Updates profile state optimistically on success so OrgContext (and
  // every currentRole-gated permission check that depends on it) picks
  // up the new org immediately, without waiting for a full re-fetch.
  async function switchCurrentOrg(orgId) {
    if (!user?.id) return { ok: false, error: 'Not signed in.' }
    const isMember = (profile?.coachOrgs ?? []).some(c => c.org_id === orgId)
    if (!isMember) return { ok: false, error: 'You are not part of that program.' }

    const { error } = await supabase
      .from('profiles')
      .update({ current_org_id: orgId })
      .eq('id', user.id)
    if (error) return { ok: false, error: error.message }

    setProfile(prev => (prev ? { ...prev, current_org_id: orgId } : prev))
    return { ok: true }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, switchCurrentOrg }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
