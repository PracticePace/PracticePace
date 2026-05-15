import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { isAd } from '../lib/permissions'
import { getSampleScriptForSport } from '../lib/sampleScripts'
import Logo from '../components/Logo'
import AudioSection from '../components/dashboard/AudioSection'
import { setPlaylist as setAudioPlaylist } from '../lib/audioPlayer'

import PracticeSection   from '../components/dashboard/PracticeSection'
import ScriptsSection    from '../components/dashboard/ScriptsSection'
import ScoreboardSection from '../components/dashboard/ScoreboardSection'
import VideoSection      from '../components/dashboard/VideoSection'
import SettingsSection   from '../components/dashboard/SettingsSection'
import WhiteboardSection from '../components/dashboard/WhiteboardSection'
import PlaybookSection   from '../components/dashboard/PlaybookSection'
import PlanSelectModal   from '../components/dashboard/PlanSelectModal'
import ProgramSwitcher   from '../components/dashboard/ProgramSwitcher'

import {
  getGuestScripts,
  getGuestActiveId,
  setGuestActiveId,
  seedGuestIfEmpty,
} from '../lib/guestStorage'

// Per-user localStorage key for the last loaded script id
const activeScriptKey = uid => `pp_active_script_${uid}`

// Per-user localStorage key for the AD's currently-active program.
// AD-only — every other role uses their profile.org_id directly. See
// PIECE 3 of Commit 2b for the design rationale (localStorage trades
// cross-device persistence for zero-migration simplicity).
const activeOrgKey = uid => `pp_active_org_${uid}`

// ── Icons ─────────────────────────────────────────────────────────────────────
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const Ico = ({ children, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" {...S}>{children}</svg>

const ClockIcon  = ({ size }) => <Ico size={size}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>
const FileIcon   = ({ size }) => <Ico size={size}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></Ico>
// PenToolIcon — Whiteboard tab (lucide PenTool). Visually distinct from
// the FileIcon used by Scripts and the BookIcon used by Playbook.
const PenToolIcon = ({ size }) => <Ico size={size}><path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/></Ico>
// BookIcon — Playbook tab. Lucide "book" silhouette.
const BookIcon   = ({ size }) => <Ico size={size}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></Ico>
const ListIcon   = ({ size }) => <Ico size={size}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></Ico>
const VideoIcon  = ({ size }) => <Ico size={size}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></Ico>
const MusicIcon  = ({ size }) => <Ico size={size}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></Ico>
const GearIcon   = ({ size }) => <Ico size={size}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></Ico>
const LogoutIcon = () => <Ico size={16}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></Ico>

// ── Nav items (settings hidden for guests — handled in render) ─────────────────
const NAV = [
  { id: 'practice',   label: 'Practice',   Icon: ClockIcon   },
  { id: 'scripts',    label: 'Scripts',    Icon: FileIcon    },
  { id: 'scoreboard', label: 'Scoreboard', Icon: ListIcon    },
  { id: 'video',      label: 'Video',      Icon: VideoIcon   },
  { id: 'audio',      label: 'Music',      Icon: MusicIcon   },
  { id: 'whiteboard', label: 'Whiteboard', Icon: PenToolIcon },
  { id: 'settings',   label: 'Settings',   Icon: GearIcon    },
  { id: 'playbook',   label: 'Playbook',   Icon: BookIcon    },
]

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, profile: authProfile, signOut, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  // Anonymous Supabase users have is_anonymous === true
  const isGuest = user?.is_anonymous === true

  // org_id comes directly from the profile row — no join required
  const contextOrgId = authProfile?.org_id ?? null

  const [section, setSection]           = useState('practice')
  const [org, setOrg]                   = useState(null)
  // Surfaced by the loadAll outer catch when an unexpected error prevents
  // the dashboard from initialising. Renders a top banner with a Refresh
  // button so the user has a path other than reload-by-hand.
  const [loadAllErr, setLoadAllErr]     = useState('')
  // Multi-program (Commit 2b): the list of orgs visible to the current
  // user. For an AD, this is all orgs in their account; for everyone else
  // it's just their one org. Drives the program switcher in the header.
  const [allOrgs, setAllOrgs]           = useState([])
  // accountProgramCount = account-wide org count, served by the
  // get_my_account_program_count() SECURITY DEFINER RPC (migration
  // 20260517010000). Distinct from allOrgs.length because head_coach /
  // assistant_coach / team_manager are RLS-restricted to seeing only
  // their own org — their allOrgs.length = 1 even when the account has
  // multiple programs. This account-wide count drives:
  //   • the "Athletic Director" vs "Head Coach" friendly-label decision
  //     for role='ad' (renders correctly for non-AD viewers too)
  //   • the canAddProgram gate in SettingsSection (head_coach can only
  //     add a program when the account currently has exactly 1).
  const [accountProgramCount, setAccountProgramCount] = useState(0)
  // activeOrgId is the org-id we use for every downstream fetch — scripts,
  // songs, scoreboard configs, etc. For AD users it can differ from
  // profile.org_id (they may be operating in a sibling program); for all
  // other roles it equals profile.org_id.
  const [activeOrgId, setActiveOrgId]   = useState(null)
  const [profile, setProfile]           = useState(null)
  const [scripts, setScripts]           = useState([])
  const [activeScript, _rawSetActiveScript] = useState(null)
  // Wrapper preserved from an earlier debug-logging pass — the call-site
  // contract is `setActiveScript(next)`. Kept as a pass-through so we can
  // hook back in trivially if we need to trace assignments again.
  const setActiveScript = (next) => {
    _rawSetActiveScript(next)
  }
  const [loading, setLoading]           = useState(true)
  const [subscription, setSubscription] = useState(null)   // subscriptions row or null
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError,   setCheckoutError]   = useState('')
  const [showPlanModal,   setShowPlanModal]   = useState(false)

  // Safety net: if loadAll() never finishes, force-unblock after 3 s
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => {
      console.warn('[Dashboard] Load timeout — forcing loading=false')
      setLoading(false)
    }, 3000)
    return () => clearTimeout(t)
  }, [loading])

  // App resume fix: when the tab becomes visible again, check the session
  // once. If valid, clear any stuck loading state — do NOT reload data.
  // If the session is gone (expired), redirect to login.
  // Registered once with [] so tab-switching never triggers loadAll().
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          console.warn('[Dashboard] Session expired on resume — redirecting to login')
          navigate('/')
          return
        }
        // Session valid — just unblock any stuck loading spinner, nothing else
        setLoading(false)
      } catch {
        setLoading(false)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // (Previously this component subscribed to audioPlayer state to render a
  // standalone "Now Playing" docked bar above the tab bar. That bar was
  // removed; the song-name + transport controls now live exclusively in
  // the Practice tab's slide-up MusicMiniControls. Dashboard no longer
  // needs to observe audio state directly.)

  const orgColor = org?.primary_color ?? '#cc1111'

  // ── Subscription derived state ─────────────────────────────────────────────
  const subStatus   = subscription?.status ?? null
  const trialEndsAt = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at) : null
  const now         = new Date()
  const daysLeft    = trialEndsAt ? Math.ceil((trialEndsAt - now) / 86400000) : null
  // Trial expired = trial_ends_at has passed and not yet converted to active
  const trialExpired = trialEndsAt !== null && trialEndsAt < now && subStatus !== 'active'
  // Subtle amber banner — only shown in the last 3 days of a live trial
  const showTrialBanner = !isGuest && subStatus === 'trialing' && daysLeft !== null && daysLeft > 0 && daysLeft <= 3
  // Full-screen paywall: canceled, past_due, or trial ran out
  const showPaywall = !isGuest && subStatus !== null && (
    subStatus === 'canceled' ||
    subStatus === 'past_due' ||
    trialExpired
  )

  // Use user?.id (stable string) not user (new object every token refresh).
  // Without this, every token refresh fires loadAll() and makes the app
  // look like it's reloading every time the user switches back to the tab.
  useEffect(() => {
    if (user?.id) loadAll()
  }, [user?.id])

  async function loadAll() {
    // ── Guest path: everything comes from localStorage ──────────────────────
    if (isGuest) {
      try {
        seedGuestIfEmpty()
        const guestScripts = getGuestScripts()
        setScripts(guestScripts)

        const activeId = getGuestActiveId()
        const active   = guestScripts.find(s => s.id === activeId) ?? guestScripts[0] ?? null
        setActiveScript(active)
      } catch (err) {
        console.error('[Dashboard] Guest loadAll error:', err)
      } finally {
        setLoading(false)
      }
      return
    }

    // ── Authenticated path: Supabase ─────────────────────────────────────────
    try {
      // Fetch profile first, then fetch org explicitly by org_id.
      // We do NOT use the nested organizations(*) join because PostgREST can
      // return null for it silently if the FK schema cache hasn't refreshed.
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, org_id, account_id, full_name, email, role')
        .eq('id', user.id)
        .maybeSingle()

      console.log('[Dashboard] profile:', {
        id:         prof?.id,
        org_id:     prof?.org_id,
        account_id: prof?.account_id,
      })

      setProfile(prof ?? null)

      // ── Load all orgs visible to this user ────────────────────────────────
      // For an AD, RLS lets them SELECT every org in their account; for
      // any other role it's just their own org. So we don't need a role
      // check here — the policy does the filtering. We just sort the
      // result for the switcher's display order.
      const { data: orgsList } = await supabase
        .from('organizations')
        .select('*')
        .order('name', { ascending: true })
      const orgsArr = orgsList ?? []
      setAllOrgs(orgsArr)

      // ── Account-wide program count (RPC) ──────────────────────────────────
      // Bypasses the org SELECT RLS via SECURITY DEFINER — see migration
      // 20260517010000. We need this because non-AD viewers see only
      // their own org through `orgsList` above, but the friendly-label
      // and Add-Program-eligibility logic both want the true account
      // total.
      try {
        const { data: countResult, error: countErr } = await supabase
          .rpc('get_my_account_program_count')
        if (countErr) {
          console.warn('[Dashboard] account program count RPC failed:', countErr.message)
          // Fallback: trust allOrgs.length. Safe for AD (matches the
          // RPC); slight under-count for non-AD viewers, but never
          // higher than truth, so canAddProgram won't open false doors.
          setAccountProgramCount(orgsArr.length)
        } else {
          setAccountProgramCount(typeof countResult === 'number' ? countResult : (countResult ?? 0))
        }
      } catch (err) {
        console.warn('[Dashboard] account program count RPC threw:', err?.message ?? err)
        setAccountProgramCount(orgsArr.length)
      }

      // ── Resolve activeOrgId ────────────────────────────────────────────────
      // AD: respect a previously-stored selection in localStorage (must
      //     still be a visible org); fall back to profile.org_id; fall
      //     back to first alphabetical org.
      // Everyone else: just use profile.org_id (their only org).
      let resolvedOrgId
      if (isAd(prof?.role)) {
        let saved = null
        try { saved = localStorage.getItem(activeOrgKey(user.id)) } catch {}
        const savedIsVisible = saved && orgsArr.some(o => o.id === saved)
        resolvedOrgId = savedIsVisible
          ? saved
          : (prof?.org_id && orgsArr.some(o => o.id === prof.org_id))
              ? prof.org_id
              : (orgsArr[0]?.id ?? null)
      } else {
        resolvedOrgId = prof?.org_id ?? contextOrgId ?? null
      }
      setActiveOrgId(resolvedOrgId)

      // Active org row — pulled from the already-loaded list when
      // possible to avoid an extra round-trip. If not in the list (rare
      // — e.g. profile.org_id points at an org the user can't SELECT
      // due to a stale profile row) fetch explicitly.
      let orgData = orgsArr.find(o => o.id === resolvedOrgId) ?? null
      if (!orgData && resolvedOrgId) {
        const { data: orgFetch } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', resolvedOrgId)
          .maybeSingle()
        orgData = orgFetch ?? null
      }
      setOrg(orgData)

      if (resolvedOrgId) {
        const list = await loadScripts(resolvedOrgId)
        if (list.length === 0) {
          const sample = await seedSampleScript(resolvedOrgId, user.id, orgData?.sport?.toLowerCase())
          if (sample) {
            setScripts([sample])
            setActiveScript(sample)
            try {
              localStorage.setItem(activeScriptKey(user.id), sample.id)
            } catch {}
          }
        } else {
          // Restore the last loaded script for this user, if it still exists.
          // If no match, we deliberately leave activeScript as-is rather than
          // clobbering whatever the component already had.
          const savedId = (() => { try { return localStorage.getItem(activeScriptKey(user.id)) } catch { return null } })()
          const restored = savedId ? list.find(s => s.id === savedId) : null
          if (restored) setActiveScript(restored)
        }

        // Load the org's saved music playlist into the audioPlayer singleton
        // on dashboard mount. Without this, the inline music controls on the
        // Practice tab stay disabled until the user visits the Music tab.
        // The Music tab's loadSongs effect will refetch when opened — same
        // behavior the existing onRefresh-after-upload flow relies on.
        try {
          const { data: songsData, error: songsErr } = await supabase
            .from('songs')
            .select('*')
            .eq('org_id', resolvedOrgId)
            .order('position',   { ascending: true })
            .order('created_at', { ascending: true })
          if (songsErr) {
            console.warn('[Dashboard] songs fetch failed (mini player will stay disabled):', songsErr.message)
          } else {
            const songList = songsData ?? []
            console.log('[Dashboard] preloaded music playlist:', songList.length, 'songs')
            setAudioPlaylist(songList)
          }
        } catch (err) {
          console.warn('[Dashboard] songs fetch threw:', err?.message ?? err)
        }

        // Fetch account/subscription status from the accounts table.
        // The accounts row id matches profile.account_id (set during onboarding).
        const accountId = prof?.account_id ?? null
        console.log('[Dashboard] fetching account status — account_id:', accountId)

        if (accountId) {
          const { data: accountData, error: accountErr } = await supabase
            .from('accounts')
            .select('*')
            .eq('id', accountId)
            .single()

          if (accountErr) {
            console.error('[Dashboard] accounts fetch error:', accountErr.message)
          } else {
            console.log('[Dashboard] account row:', {
              id:         accountData?.id,
              status:     accountData?.status,
              trial_ends_at: accountData?.trial_ends_at,
              stripe_customer_id: accountData?.stripe_customer_id ? '(set)' : '(null)',
            })
          }
          setSubscription(accountData ?? null)
        } else {
          console.warn('[Dashboard] profile.account_id is null — no account row to fetch')
          setSubscription(null)
        }
      }
    } catch (err) {
      console.error('[Dashboard] loadAll error:', err)
      // Surface a user-visible signal. The dashboard sections will render
      // with whatever partial state we managed to set before the throw —
      // the banner gives the user a path to retry rather than a silent
      // blank surface.
      setLoadAllErr("Couldn't load your data. Refresh to try again.")
    } finally {
      setLoading(false)
    }
  }

  // ── Open plan selector modal ───────────────────────────────────────────────
  // All "Subscribe" entry points open the modal first so the coach can choose
  // their plan before being sent to Stripe.
  function openPlanModal() {
    setCheckoutError('')
    setShowPlanModal(true)
  }

  // ── Stripe checkout — called by PlanSelectModal after plan is chosen ───────
  async function startCheckout(priceId) {
    setCheckoutError('')

    if (!org?.id) {
      setCheckoutError('Organization not loaded — please wait and try again.')
      console.warn('[Dashboard] startCheckout: org.id is missing', { org, user })
      return
    }
    if (!user?.email) {
      setCheckoutError('User email not found — please reload and try again.')
      console.warn('[Dashboard] startCheckout: user.email is missing', { user })
      return
    }
    if (!priceId || priceId === 'undefined') {
      setCheckoutError('Stripe price ID is not configured — check VITE_STRIPE_PRICE_* environment variables.')
      console.error('[Dashboard] startCheckout: priceId is invalid:', priceId)
      return
    }

    // skipTrial = coach is converting from an existing in-app trial.
    // Stripe will show "Subscribe" not "Start trial" and won't add another
    // 14-day grace period on top of the one they already received.
    const trialStillActive =
      subscription?.status === 'trialing' &&
      subscription?.trial_ends_at &&
      new Date(subscription.trial_ends_at) > new Date()
    const skipTrial = trialStillActive

    // accountId must be the accounts table UUID (not the organizations UUID).
    // subscription state IS the accounts row, so subscription.id is correct.
    const accountId = subscription?.id ?? null
    if (!accountId) {
      setCheckoutError('Account ID not found — please reload and try again.')
      console.error('[Dashboard] startCheckout: subscription.id is missing', { subscription })
      return
    }

    console.log('[Dashboard] startCheckout →', { priceId, skipTrial, accountId, orgId: org.id })

    setCheckoutLoading(true)
    try {
      const res = await fetch('/api/stripe-checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          priceId,
          accountId,           // accounts.id — the webhook upserts WHERE id = accountId
          email:     user.email,
          orgName:   org.name ?? '',
          skipTrial,
        }),
      })
      const data = await res.json().catch(() => ({}))
      console.log('[Dashboard] startCheckout ← API response', res.status, data)
      if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`)
      if (!data.url) throw new Error('No redirect URL returned from checkout API')
      window.location.href = data.url
    } catch (err) {
      console.error('[Dashboard] startCheckout error:', err.message)
      setCheckoutError(err.message ?? 'Checkout failed — please try again.')
      setCheckoutLoading(false)
    }
  }

  async function loadScripts(orgId) {
    // ── Guest ──────────────────────────────────────────────────────────────
    if (isGuest) {
      const list = getGuestScripts()
      setScripts(list)
      return list
    }

    // ── Authenticated ──────────────────────────────────────────────────────
    // Prefer the explicit orgId arg, then the one in context, then org state
    // Prefer the explicit orgId arg, then the current active org (which
    // is what the AD's program switcher controls), then the auth-context
    // fallback for early-load races.
    const id = orgId ?? activeOrgId ?? org?.id ?? contextOrgId
    if (!id) return []
    const { data } = await supabase
      .from('scripts')
      .select('*')
      .eq('org_id', id)
      .order('created_at', { ascending: false })
    const list = data ?? []
    setScripts(list)
    return list
  }

  async function seedSampleScript(orgId, userId, sport = 'football') {
    // Sport-aware seed — see src/lib/sampleScripts.js. cheerleading
    // programs get a comp-week-shaped 15-drill script; every other
    // sport gets the legacy "Sample Practice — 90 min" default.
    const { name, drills } = getSampleScriptForSport(sport)
    const { data, error } = await supabase
      .from('scripts')
      .insert({ org_id: orgId, created_by: userId, name, sport: sport.toLowerCase(), drills })
      .select()
      .single()
    if (error) return null
    return data
  }

  function handleSetActive(script) {
    setActiveScript(script)
    if (isGuest) {
      setGuestActiveId(script?.id ?? null)
    } else if (user?.id) {
      try {
        if (script?.id) {
          localStorage.setItem(activeScriptKey(user.id), script.id)
        } else {
          localStorage.removeItem(activeScriptKey(user.id))
        }
      } catch {}
    }
    if (script) setSection('practice')
  }

  function handleOrgUpdate(updated) {
    setOrg(updated)
    // Keep the list-of-all-orgs in sync with the per-org edit (e.g. AD
    // renames a program — the switcher should show the new name without
    // a reload).
    setAllOrgs(prev => prev.map(o => (o.id === updated.id ? { ...o, ...updated } : o)))
  }

  // ── New program created (from Settings → Add Program) ────────────────────
  // The AddProgramDialog in SettingsSection fires this after a successful
  // /api/add-program call. We:
  //   1. Refetch the orgs list so the header switcher and the local
  //      `allOrgs` state see the new program immediately.
  //   2. If this was the 1→2 upgrade and the API promoted the caller from
  //      head_coach → ad, refetch the caller's profile too so future
  //      RLS-gated reads (especially the switcher's visibility check)
  //      pick up the new role.
  //   3. Switch the active program to the new one — the AD almost always
  //      wants to set it up next (logo, colors, coaches).
  async function handleProgramCreated(newOrgId, opts = {}) {
    const { promotedToAd } = opts
    try {
      const { data: orgsList } = await supabase
        .from('organizations')
        .select('*')
        .order('name', { ascending: true })
      const orgsArr = orgsList ?? []
      setAllOrgs(orgsArr)

      // Refresh the account-wide program count too. Critical for the
      // friendly-label decision: a head_coach who self-promotes during
      // the 1→2 upgrade will now have role='ad', and the new program
      // count of 2 flips their label from "Head Coach" to "Athletic
      // Director" in subsequent renders. If we don't refresh this,
      // SettingsSection's isMultiProgram stays false and the badge
      // still reads "Head Coach" until the next page reload.
      try {
        const { data: countResult } = await supabase
          .rpc('get_my_account_program_count')
        if (typeof countResult === 'number') setAccountProgramCount(countResult)
        else if (countResult != null)        setAccountProgramCount(countResult)
      } catch (e) {
        console.warn('[Dashboard] post-create program count refresh failed:', e?.message ?? e)
      }

      if (promotedToAd && user?.id) {
        const { data: freshProf } = await supabase
          .from('profiles')
          .select('id, org_id, account_id, full_name, email, role')
          .eq('id', user.id)
          .maybeSingle()
        if (freshProf) setProfile(freshProf)
      }

      // Land them in the new program. switchProgram persists in
      // localStorage and re-loads scripts/songs in that scope.
      if (newOrgId && orgsArr.some(o => o.id === newOrgId)) {
        // We can't reuse switchProgram() yet because it bails when
        // newOrgId === activeOrgId; but if the user was already AD and
        // somehow had this org as active (shouldn't happen — it's new),
        // there's nothing to do. In the normal path, set everything.
        try { if (user?.id) localStorage.setItem(activeOrgKey(user.id), newOrgId) } catch {}
        setActiveOrgId(newOrgId)
        const newOrg = orgsArr.find(o => o.id === newOrgId)
        setOrg(newOrg ?? null)
        // Empty collections — brand new program has no scripts/songs yet.
        setScripts([])
        setActiveScript(null)
        setAudioPlaylist([])
      }
    } catch (err) {
      console.error('[Dashboard] handleProgramCreated refresh failed:', err?.message ?? err)
    }
  }

  // ── Program deleted (from Settings → Programs delete button) ─────────────
  // Mirror of handleProgramCreated. After /api/delete-program returns
  // OK, we:
  //   1. Refetch the orgs list so the switcher / Settings list lose
  //      the deleted program.
  //   2. Refresh the account-wide program count so the friendly-label
  //      and Add-Program-eligibility logic re-evaluate.
  //   3. If the active program was the one deleted, switch to whatever
  //      remaining org sorts first. (The server-side delete refuses if
  //      the account would drop below 1 program, so there's always at
  //      least one survivor here.)
  async function handleProgramDeleted(deletedOrgId) {
    try {
      const { data: orgsList } = await supabase
        .from('organizations')
        .select('*')
        .order('name', { ascending: true })
      const orgsArr = orgsList ?? []
      setAllOrgs(orgsArr)

      try {
        const { data: countResult } = await supabase
          .rpc('get_my_account_program_count')
        if (typeof countResult === 'number') setAccountProgramCount(countResult)
        else if (countResult != null)        setAccountProgramCount(countResult)
      } catch (e) {
        console.warn('[Dashboard] post-delete program count refresh failed:', e?.message ?? e)
      }

      if (deletedOrgId === activeOrgId) {
        const fallback = orgsArr[0]?.id ?? null
        try { if (user?.id) localStorage.setItem(activeOrgKey(user.id), fallback ?? '') } catch {}
        setActiveOrgId(fallback)
        const next = orgsArr.find(o => o.id === fallback) ?? null
        setOrg(next)
        setScripts([])
        setActiveScript(null)
        setAudioPlaylist([])
      }
    } catch (err) {
      console.error('[Dashboard] handleProgramDeleted refresh failed:', err?.message ?? err)
    }
  }

  // ── AD program switch ─────────────────────────────────────────────────────
  // The AD picked a different program from the header switcher. Persist
  // their choice, update the active-org id, fetch the new org row, and
  // re-load every org-scoped collection (scripts, music, scoreboard
  // config). No full page reload — this is meant to feel instant.
  //
  // Non-AD callers should not be able to reach this, but as a defence
  // we no-op if the selected id isn't in allOrgs (i.e. the user can't
  // actually access it).
  async function switchProgram(orgId) {
    if (!orgId || orgId === activeOrgId) return
    const next = allOrgs.find(o => o.id === orgId)
    if (!next) {
      console.warn('[Dashboard] switchProgram: orgId not in allOrgs', orgId)
      return
    }

    try {
      if (user?.id) localStorage.setItem(activeOrgKey(user.id), orgId)
    } catch {}

    setActiveOrgId(orgId)
    setOrg(next)

    // Re-load org-scoped collections. We don't touch profile / account /
    // subscription — those are user-scoped, not org-scoped.
    await loadScripts(orgId)
    // Clear the activeScript pointer — it was scoped to the previous
    // program and won't exist in the new one's script list. The Scripts
    // tab will restore from localStorage on next mount if applicable.
    setActiveScript(null)

    try {
      const { data: songsData } = await supabase
        .from('songs')
        .select('*')
        .eq('org_id', orgId)
        .order('position',   { ascending: true })
        .order('created_at', { ascending: true })
      setAudioPlaylist(songsData ?? [])
    } catch (err) {
      console.warn('[Dashboard] songs reload on program switch failed:', err?.message ?? err)
      setAudioPlaylist([])
    }
  }

  // Guest taps Settings tab → redirect to scripts (guests don't have settings)
  function handleNavClick(id) {
    if (isGuest && id === 'settings') return // blocked
    setSection(id)
  }

  // Nav items shown to guests (no Settings)
  const visibleNav = isGuest ? NAV.filter(n => n.id !== 'settings') : NAV

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#080000' }}>
        <div className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: '#cc1111', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: '#080000' }}>

      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-4 md:px-6 shrink-0 z-10"
        style={{
          height: 72,
          backgroundColor: '#0d0000',
          borderBottom: `2px solid ${orgColor}`,
          boxShadow: `0 2px 24px ${orgColor}44`,
        }}
      >
        <Logo variant="white" height={52} className="shrink-0" />

        {/* Program switcher — AD-only, multi-program only.
            Sits to the immediate right of the Practice:Pace wordmark so
            the AD can pivot context quickly. Head coaches and other roles
            never see this — for them activeOrgId === profile.org_id and
            there's nothing to switch to anyway. */}
        {!isGuest && isAd(profile?.role) && allOrgs.length >= 2 && (
          <div className="ml-3 shrink-0">
            <ProgramSwitcher
              orgs={allOrgs}
              activeOrgId={activeOrgId}
              onSelect={switchProgram}
              orgColor={orgColor}
            />
          </div>
        )}

        {/* Program logo (uploaded by AD/head_coach in Settings → Program Logo).
            Renders to the LEFT of the program name when present; nothing when
            absent (no broken-image icon). Constrained height so it never
            disrupts the 72px header.

            ml-10 (40 px) of left margin gives clear visual separation from
            the Practice:Pace wordmark — previously ml-2 (8 px), which made
            the two logos read as a single visually-merged element. The
            program-name <h1> still sits to the right of the logo with its
            own px-4 padding, so the [logo + name] group still reads as
            paired. */}
        {!isGuest && org?.logo_url && (
          <img
            src={org.logo_url}
            alt=""
            className="shrink-0 ml-10"
            style={{ height: 48, maxWidth: 96, objectFit: 'contain' }}
          />
        )}

        {/* Program name as a header hero — Bebas Neue, uppercase, hex color
            from accounts.program_name_color (default white). Truncates with
            ellipsis if longer than the available space; never wraps. */}
        <h1
          className="text-center px-4 truncate"
          style={{
            fontFamily:    "'Bebas Neue', sans-serif",
            fontSize:      'clamp(22px, 3vw, 36px)',
            color:         isGuest ? '#ffffff' : (subscription?.program_name_color ?? '#ffffff'),
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            lineHeight:    1,
            flex:          '1 1 auto',
            minWidth:      0,
          }}
        >
          {isGuest ? 'Guest Mode' : (org?.name ?? '')}
        </h1>

        <button
          onClick={signOut}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'rgba(0,0,0,0.22)', color: 'rgba(255,255,255,0.88)' }}
        >
          <LogoutIcon />
          <span className="hidden sm:inline">{isGuest ? 'Exit' : 'Sign out'}</span>
        </button>
      </header>

      {/* ── Data-load error banner — surfaced when loadAll throws.
          Sections may render with partial / stale state; the banner
          gives the user a path to retry. Refresh clears the banner and
          re-runs loadAll. */}
      {loadAllErr && (
        <div
          className="shrink-0 flex items-center justify-center gap-3 px-4 py-2 text-xs font-semibold flex-wrap"
          style={{ backgroundColor: '#2a0000', borderBottom: '1px solid #4a0000' }}
        >
          <span style={{ color: '#ff9a9a' }}>⚠ {loadAllErr}</span>
          <button
            onClick={() => { setLoadAllErr(''); setLoading(true); loadAll() }}
            className="px-3 py-1.5 rounded-lg font-bold text-white transition-all active:scale-95"
            style={{ backgroundColor: '#cc1111' }}
          >
            Refresh
          </button>
        </div>
      )}

      {/* ── Trial expiry banner — amber, shown only in last 3 days ── */}
      {showTrialBanner && (
        <div
          className="shrink-0 flex items-center justify-center gap-3 px-4 py-2 text-xs font-semibold flex-wrap"
          style={{ backgroundColor: '#1a1000', borderBottom: '1px solid #3a2800' }}
        >
          <span style={{ color: '#f59e0b' }}>
            ⏳ Your trial ends in {daysLeft} day{daysLeft === 1 ? '' : 's'} — subscribe to keep access
          </span>
          <button
            onClick={openPlanModal}
            disabled={checkoutLoading}
            className="px-3 py-1.5 rounded-lg font-bold text-white disabled:opacity-50 transition-all active:scale-95"
            style={{ backgroundColor: '#b45309' }}
          >
            {checkoutLoading ? 'Loading…' : 'Subscribe →'}
          </button>
        </div>
      )}

      {/* ── Guest banner ── */}
      {isGuest && (
        <div
          className="shrink-0 flex items-center justify-center gap-3 px-4 py-2 text-xs font-semibold"
          style={{ backgroundColor: '#1a0d00', borderBottom: '1px solid #3a2000' }}
        >
          <span style={{ color: '#cc8800' }}>👤 Guest mode — data saved on this device only.</span>
          <button
            onClick={() => navigate('/')}
            className="underline font-bold transition-opacity hover:opacity-70"
            style={{ color: '#ffaa00' }}
          >
            Sign up to sync →
          </button>
        </div>
      )}

      {/* ── Subscription paywall — shown when trial expired, canceled, or past_due ── */}
      {showPaywall && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.96)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-md flex flex-col items-center gap-6">
            <div style={{ fontSize: 56 }}>🔒</div>
            <div>
              <h2 className="text-2xl font-black text-white mb-2">
                {subStatus === 'past_due'
                  ? 'Payment failed'
                  : trialExpired
                    ? 'Your free trial has ended'
                    : 'Subscription ended'}
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
                {subStatus === 'past_due'
                  ? "Your last payment didn't go through. Update your payment method to restore access."
                  : trialExpired
                    ? 'Your 14-day free trial is over. Subscribe to keep access to PracticePace.'
                    : 'Your subscription has ended. Subscribe to keep practicing with PracticePace.'}
              </p>
            </div>

            {checkoutError && (
              <p className="text-xs px-4 py-2 rounded-lg w-full text-left"
                style={{ backgroundColor: '#2a0000', color: '#ff6666', border: '1px solid #4a0000' }}>
                ⚠ {checkoutError}
              </p>
            )}

            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={openPlanModal}
                disabled={checkoutLoading}
                className="w-full py-4 rounded-xl text-base font-black text-white disabled:opacity-50"
                style={{ backgroundColor: '#cc1111', boxShadow: '0 4px 24px #cc111166' }}
              >
                {checkoutLoading ? 'Loading…' : 'Choose a plan →'}
              </button>
            </div>

            <button onClick={signOut}
              className="text-xs underline opacity-50 hover:opacity-80"
              style={{ color: '#9a8080' }}>
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 flex flex-col overflow-hidden"
          // 68 px reserves space for the fixed-position bottom tab bar.
          // Used to be `showMiniPlayer ? 120 : 68` when the standalone
          // "Now Playing" bar lived above the tabs — that bar moved into
          // the Practice tab's slide-up panel, so the extra 52 px is no
          // longer needed.
          style={{ paddingBottom: 68 }}>

          {section === 'practice' && (
            <PracticeSection
              activeScript={activeScript}
              orgColor={orgColor}
              backgroundUrl={org?.background_url ?? null}
            />
          )}

          {section === 'scripts' && (
            <ScriptsSection
              scripts={scripts}
              activeScript={activeScript}
              onSetActive={handleSetActive}
              orgId={org?.id ?? activeOrgId}
              userId={user?.id}
              orgColor={orgColor}
              isGuest={isGuest}
              orgSport={org?.sport}
              programName={org?.name ?? ''}
              programNameColor={subscription?.program_name_color ?? '#000000'}
              programLogoUrl={org?.logo_url ?? null}
              onReload={() => loadScripts(activeOrgId ?? org?.id)}
            />
          )}

          {section === 'whiteboard' && (
            <WhiteboardSection
              orgColor={orgColor}
              orgId={org?.id ?? activeOrgId}
              sport={org?.sport ?? null}
            />
          )}

          {section === 'playbook' && (
            <PlaybookSection orgColor={orgColor} />
          )}

          {section === 'scoreboard' && (
            <ScoreboardSection
                orgColor={orgColor}
                accountId={subscription?.id ?? null}
                homeTeamName={subscription?.home_team_name ?? null}
                awayTeamName={subscription?.away_team_name ?? null}
                programName={org?.name ?? null}
                sport={org?.sport ?? null}
                sportCustomLabel={org?.sport_custom_label ?? null}
              />
          )}

          {section === 'video' && (
            <VideoSection
              orgId={org?.id ?? activeOrgId}
              orgColor={orgColor}
              isGuest={isGuest}
            />
          )}

          {section === 'audio' && (
            <AudioSection orgColor={orgColor} orgId={org?.id ?? activeOrgId} />
          )}

          {section === 'settings' && !isGuest && (
            <SettingsSection
              org={org}
              profile={profile ?? authProfile}
              orgColor={orgColor}
              onOrgUpdate={handleOrgUpdate}
              subscription={subscription}
              onSubscriptionUpdate={updated => setSubscription(updated)}
              onStartCheckout={openPlanModal}
              checkoutLoading={checkoutLoading}
              checkoutError={checkoutError}
              programCount={accountProgramCount}
              onProgramCreated={handleProgramCreated}
              allOrgs={allOrgs}
              activeOrgId={activeOrgId}
              onProgramDeleted={handleProgramDeleted}
            />
          )}

        </main>
      </div>

      {/* (The standalone "Now Playing" docked bar that used to live here
          — between <main> and the tab bar, height 52, fixed bottom: 68 —
          was removed when the song-name display was integrated into the
          Practice tab's slide-up MusicMiniControls. The bottom of the
          stage view is now empty between "Next Up" and the bottom nav,
          with only the CONTROLS peek handle visible. The audioPlayer
          singleton continues to play across navigation — what was
          removed was just the redundant UI surface. The `showMiniPlayer`
          flag and the conditional `paddingBottom` on <main> were
          collapsed to a constant 68 px since no extra space is needed
          for a non-existent bar. */}

      {/* ── Tab bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 flex z-20"
        style={{ height: 68, backgroundColor: '#0d0000', borderTop: `1px solid ${orgColor}44` }}
      >
        {visibleNav.map(({ id, label, Icon }) => {
          const active = section === id
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className="flex-1 flex flex-col items-center justify-center gap-1 font-semibold transition-colors"
              style={{ color: active ? orgColor : '#7a6060', fontSize: 13 }}
            >
              <Icon size={22} />
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

      {/* ── Plan selector modal ── */}
      {showPlanModal && (
        <PlanSelectModal
          onConfirm={priceId => startCheckout(priceId)}
          onClose={() => { setShowPlanModal(false); setCheckoutError('') }}
          loading={checkoutLoading}
          error={checkoutError}
        />
      )}

    </div>
  )
}
