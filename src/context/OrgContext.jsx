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

  return (
    <OrgContext.Provider value={{ org, loading }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
