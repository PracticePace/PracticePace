import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import AudioSection from '../components/dashboard/AudioSection'
import {
  subscribe as subscribeAudio,
  getSnapshot as getAudioSnapshot,
  togglePlay as audioTogglePlay,
  setPlaylist as setAudioPlaylist,
} from '../lib/audioPlayer'

import PracticeSection   from '../components/dashboard/PracticeSection'
import ScriptsSection    from '../components/dashboard/ScriptsSection'
import ScoreboardSection from '../components/dashboard/ScoreboardSection'
import VideoSection      from '../components/dashboard/VideoSection'
import SettingsSection   from '../components/dashboard/SettingsSection'
import PlaybookSection   from '../components/dashboard/PlaybookSection'
import PlanSelectModal   from '../components/dashboard/PlanSelectModal'

import {
  getGuestScripts,
  getGuestActiveId,
  setGuestActiveId,
  seedGuestIfEmpty,
} from '../lib/guestStorage'

// Per-user localStorage key for the last loaded script id
const activeScriptKey = uid => `pp_active_script_${uid}`

// ── Icons ─────────────────────────────────────────────────────────────────────
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const Ico = ({ children, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" {...S}>{children}</svg>

const ClockIcon  = ({ size }) => <Ico size={size}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ico>
const FileIcon   = ({ size }) => <Ico size={size}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></Ico>
const BookIcon   = ({ size }) => <Ico size={size}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></Ico>
const ListIcon   = ({ size }) => <Ico size={size}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></Ico>
const VideoIcon  = ({ size }) => <Ico size={size}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></Ico>
const MusicIcon  = ({ size }) => <Ico size={size}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></Ico>
const GearIcon   = ({ size }) => <Ico size={size}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></Ico>
const LogoutIcon = () => <Ico size={16}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></Ico>

// ── Nav items (settings hidden for guests — handled in render) ─────────────────
const NAV = [
  { id: 'practice',   label: 'Practice',   Icon: ClockIcon },
  { id: 'scripts',    label: 'Scripts',    Icon: FileIcon },
  { id: 'scoreboard', label: 'Scoreboard', Icon: ListIcon },
  { id: 'video',      label: 'Video',      Icon: VideoIcon },
  { id: 'audio',      label: 'Music',      Icon: MusicIcon },
  { id: 'settings',   label: 'Settings',   Icon: GearIcon },
  { id: 'playbook',   label: 'Playbook',   Icon: BookIcon },
]

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  console.log('[ACTIVE] Dashboard mount (component body running)')
  const { user, profile: authProfile, signOut, loading: authLoading } = useAuth()
  console.log('[ACTIVE] Dashboard render — user.id:', user?.id ?? null, 'isGuest:', user?.is_anonymous === true, 'authLoading:', authLoading, 'authProfile.id:', authProfile?.id ?? null)
  const navigate = useNavigate()

  // Anonymous Supabase users have is_anonymous === true
  const isGuest = user?.is_anonymous === true

  // org_id comes directly from the profile row — no join required
  const contextOrgId = authProfile?.org_id ?? null

  const [section, setSection]           = useState('practice')
  const [org, setOrg]                   = useState(null)
  const [profile, setProfile]           = useState(null)
  const [scripts, setScripts]           = useState([])
  const [activeScript, _rawSetActiveScript] = useState(null)
  // [ACTIVE-DEBUG] logging wrapper around setActiveScript so every change is traced.
  const setActiveScript = (next) => {
    try {
      const id = next?.id ?? null
      console.log('[ACTIVE] setActiveScript called with:', id, 'name:', next?.name ?? null)
      console.log('[ACTIVE] setActiveScript stack:', new Error().stack)
    } catch {}
    _rawSetActiveScript(next)
  }
  const [loading, setLoading]           = useState(true)
  const [subscription, setSubscription] = useState(null)   // subscriptions row or null
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError,   setCheckoutError]   = useState('')
  const [showPlanModal,   setShowPlanModal]   = useState(false)

  // [ACTIVE-DEBUG] Mount/unmount logger so we can confirm if Dashboard is being
  // unmounted-and-remounted (e.g. by ProtectedRoute flipping its `loading` flag).
  useEffect(() => {
    console.log('[ACTIVE] Dashboard mounted (useEffect [])')
    return () => { console.log('[ACTIVE] Dashboard unmount (useEffect [] cleanup)') }
  }, [])

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

  // ── MP3 mini player state ──────────────────────────────────────────────────
  const [audioSnap, setAudioSnap] = useState(() => getAudioSnapshot())
  useEffect(() => {
    return subscribeAudio((type, payload) => {
      if (type === 'state') setAudioSnap({ ...payload })
    })
  }, [])

  const showMiniPlayer = !!(audioSnap.song && audioSnap.isPlaying)

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
    console.log('[ACTIVE] loadAll-trigger effect fired, user.id:', user?.id ?? null, 'isGuest:', user?.is_anonymous === true)
    if (user?.id) loadAll()
  }, [user?.id])

  async function loadAll() {
    // ── Guest path: everything comes from localStorage ──────────────────────
    if (isGuest) {
      try {
        seedGuestIfEmpty()
        const guestScripts = getGuestScripts()
        console.log('[ACTIVE] Guest scripts loaded:', guestScripts.length, 'ids:', guestScripts.map(s => s.id))
        setScripts(guestScripts)

        const activeId = getGuestActiveId()
        console.log('[ACTIVE] restoring from localStorage:', activeId, '(guest path, key=pp_guest_active_id)')
        const active   = guestScripts.find(s => s.id === activeId) ?? guestScripts[0] ?? null
        console.log('[ACTIVE] guest restore resolved to script id:', active?.id ?? null, 'name:', active?.name ?? null)
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

      const resolvedOrgId = prof?.org_id ?? contextOrgId

      // Explicit org fetch — always reliable, never depends on FK join caching
      let orgData = null
      if (resolvedOrgId) {
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
              console.log('[ACTIVE] localStorage write:', activeScriptKey(user.id), '=', sample.id, '(seed sample path)')
              localStorage.setItem(activeScriptKey(user.id), sample.id)
            } catch {}
          }
        } else {
          // Restore the last loaded script for this user, if it still exists
          const savedId = (() => { try { return localStorage.getItem(activeScriptKey(user.id)) } catch { return null } })()
          console.log('[ACTIVE] restoring from localStorage:', savedId, '(auth path, key=' + activeScriptKey(user.id) + ')')
          const restored = savedId ? list.find(s => s.id === savedId) : null
          console.log('[ACTIVE] auth restore resolved to script id:', restored?.id ?? null, 'name:', restored?.name ?? null, 'matched:', !!restored)
          if (restored) setActiveScript(restored)
          else console.log('[ACTIVE] auth restore: no match — activeScript left as-is (current value will not be overwritten by restore)')
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
      console.log('[ACTIVE] loadScripts (guest) returned:', list.length, 'scripts, ids:', list.map(s => s.id))
      setScripts(list)
      return list
    }

    // ── Authenticated ──────────────────────────────────────────────────────
    // Prefer the explicit orgId arg, then the one in context, then org state
    const id = orgId ?? contextOrgId ?? org?.id
    if (!id) {
      console.log('[ACTIVE] loadScripts (auth) skipped — no orgId resolved')
      return []
    }
    const { data } = await supabase
      .from('scripts')
      .select('*')
      .eq('org_id', id)
      .order('created_at', { ascending: false })
    const list = data ?? []
    console.log('[ACTIVE] Supabase scripts fetch returned:', list.length, 'scripts, ids:', list.map(s => s.id))
    setScripts(list)
    return list
  }

  async function seedSampleScript(orgId, userId, sport = 'football') {
    const drills = [
      { name: 'Warm Up & Stretch',      duration: 10 * 60 },
      { name: 'Individual / Position',  duration: 20 * 60 },
      { name: 'Group / Unit Period',    duration: 15 * 60 },
      { name: 'Team Period',            duration: 25 * 60 },
      { name: 'Special Teams',          duration: 10 * 60 },
      { name: 'Conditioning',           duration:  8 * 60 },
      { name: 'Cool Down',              duration:  2 * 60 },
    ]
    const { data, error } = await supabase
      .from('scripts')
      .insert({ org_id: orgId, created_by: userId, name: 'Sample Practice — 90 min', sport: sport.toLowerCase(), drills })
      .select()
      .single()
    if (error) return null
    return data
  }

  function handleSetActive(script) {
    console.log('[ACTIVE] handleSetActive invoked with script id:', script?.id ?? null, 'name:', script?.name ?? null, 'isGuest:', isGuest)
    setActiveScript(script)
    if (isGuest) {
      setGuestActiveId(script?.id ?? null)
    } else if (user?.id) {
      try {
        if (script?.id) {
          console.log('[ACTIVE] localStorage write:', activeScriptKey(user.id), '=', script.id, '(handleSetActive)')
          localStorage.setItem(activeScriptKey(user.id), script.id)
        } else {
          console.log('[ACTIVE] localStorage clear:', activeScriptKey(user.id), '(handleSetActive — script null)')
          localStorage.removeItem(activeScriptKey(user.id))
        }
      } catch {}
    }
    if (script) setSection('practice')
  }

  function handleOrgUpdate(updated) {
    setOrg(updated)
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

        <span className="font-bold text-white text-sm md:text-base text-center truncate px-4 max-w-[200px] md:max-w-sm">
          {isGuest ? 'Guest Mode' : (org?.name ?? '')}
        </span>

        <button
          onClick={signOut}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'rgba(0,0,0,0.22)', color: 'rgba(255,255,255,0.88)' }}
        >
          <LogoutIcon />
          <span className="hidden sm:inline">{isGuest ? 'Exit' : 'Sign out'}</span>
        </button>
      </header>

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
          style={{ paddingBottom: showMiniPlayer ? 120 : 68 }}>

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
              orgId={org?.id ?? contextOrgId}
              userId={user?.id}
              orgColor={orgColor}
              isGuest={isGuest}
              orgSport={org?.sport}
              onReload={() => loadScripts(org?.id ?? contextOrgId)}
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
              />
          )}

          {section === 'video' && (
            <VideoSection
              orgId={org?.id ?? contextOrgId}
              orgColor={orgColor}
              isGuest={isGuest}
            />
          )}

          {section === 'audio' && (
            <AudioSection orgColor={orgColor} />
          )}

          {section === 'settings' && !isGuest && (
            <SettingsSection
              org={org}
              profile={profile ?? authProfile}
              orgColor={orgColor}
              onOrgUpdate={handleOrgUpdate}
              subscription={subscription}
              onStartCheckout={openPlanModal}
              checkoutLoading={checkoutLoading}
              checkoutError={checkoutError}
            />
          )}

        </main>
      </div>

      {/* ── MP3 mini player (shown on all tabs when a song is playing) ── */}
      {showMiniPlayer && (() => {
        const { song, isPlaying } = audioSnap
        return (
          <div
            className="fixed left-0 right-0 flex items-center gap-3 px-4"
            style={{
              bottom: 68, height: 52, zIndex: 19,
              backgroundColor: '#0d0800',
              borderTop: `1px solid ${orgColor}33`,
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center"
              style={{ backgroundColor: `${orgColor}22` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={orgColor} strokeWidth="2" strokeLinecap="round">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate leading-tight">{song?.name ?? ''}</p>
              <p className="text-xs leading-tight" style={{ color: '#9a8080' }}>Now Playing</p>
            </div>
            <button
              onClick={() => audioTogglePlay().catch(() => {})}
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
              style={{ backgroundColor: orgColor, boxShadow: `0 0 12px ${orgColor}66` }}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 2 }}>
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              )}
            </button>
          </div>
        )
      })()}

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
