import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const OrgContext = createContext(null)

export function OrgProvider({ children }) {
  // Use profile (not just user) — profile.current_org_id is the org the
  // coach is actively viewing right now (Commit B). Distinct from
  // profile.org_id, which is the coach's permanent "home" org and is no
  // longer what scoping reads should use.
  const { profile } = useAuth()
  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.current_org_id) {
      setOrg(null)
      setLoading(false)
      return
    }

    supabase
      .from('organizations')
      .select('*')
      .eq('id', profile.current_org_id)   // match organizations.id to profile.current_org_id
      .single()
      .then(({ data, error }) => {
        if (error) console.error('OrgContext fetch error:', error.message)
        setOrg(data ?? null)
        setLoading(false)
      })
  }, [profile?.current_org_id])

  // Commit C: per-org role, not profile.role. profile.role is ambiguous
  // once a coach belongs to 2+ orgs with different roles — the coach_orgs
  // row for the currently-viewed org is the source of truth. Falls back
  // to profile.role when no matching coach_orgs row exists (e.g. an AD
  // viewing a sibling org via the switcher that they have no coach_orgs
  // membership row for — their account-wide 'ad' role still applies via
  // RLS's account-wide carve-out, so it's the correct fallback here too).
  const coachOrgs = profile?.coachOrgs ?? []
  const currentOrgId = profile?.current_org_id ?? null
  const currentRole = coachOrgs.find(c => c.org_id === currentOrgId)?.role ?? profile?.role ?? null

  return (
    <OrgContext.Provider value={{ org, loading, currentOrgId, currentRole, coachOrgs }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
