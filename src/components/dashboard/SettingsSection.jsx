// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE STORAGE SETUP (one-time, do this before using background upload):
//   1. Go to your Supabase project → Storage → New bucket
//   2. Name it exactly:  backgrounds
//   3. Toggle "Public bucket" ON
//   4. Click Create
//
// Also run this SQL if you haven't already:
//   ALTER TABLE organizations ADD COLUMN IF NOT EXISTS background_url text;
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { SPORTS } from '../../lib/sports'
import { roleLabel, canRemoveCoach, canEditCoachRole } from '../../lib/permissions'
import AddProgramDialog from './AddProgramDialog'

// Allowed role values (DB-side). Order matters for the invite dropdown:
// the default selection is assistant_coach (most-common invite). Athletic
// Director ('ad') is intentionally NOT included here — AD promotions go
// through a different (manual) path so a head_coach can't escalate via the
// invite endpoint. See api/invite-coach.js for the matching server-side gate.
const ROLES = ['assistant_coach', 'team_manager', 'head_coach']

// Role badge colours, keyed by DB value.
const ROLE_STYLE = {
  ad:              { bg: '#2a1a00', color: '#fbbf24', border: '#5a3a00' },
  head_coach:      { bg: '#3a0000', color: '#ff6666', border: '#6a0000' },
  assistant_coach: { bg: '#001a2e', color: '#60a5fa', border: '#003a5e' },
  team_manager:    { bg: '#1a1a1a', color: '#9a9a9a', border: '#333333' },
}

// Roles that can manage coaches and send invites. Legacy accounts with a
// missing role still slip through (defensive — early users predate the
// role column). Matches the RLS gate on profiles INSERT/UPDATE which uses
// get_my_role() IN ('ad','head_coach').
function canManageCoaches(role) {
  return role === 'ad' || role === 'head_coach' || !role
}

function RoleBadge({ role, isMultiProgram }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.team_manager
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {roleLabel(role, isMultiProgram)}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section must live OUTSIDE SettingsSection so React never creates a new
// component-type reference on each render — that would unmount/remount every
// child (including focused inputs) on every keystroke.
// ─────────────────────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-4 p-5 rounded-2xl"
      style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>
      <h3 className="font-bold text-white text-base">{title}</h3>
      {children}
    </div>
  )
}

// ── Price ID → human label ────────────────────────────────────────────────────
const PRICE_LABELS = {
  [import.meta.env.VITE_STRIPE_PRICE_SINGLE_MONTHLY]: 'Single Program — Monthly',
  [import.meta.env.VITE_STRIPE_PRICE_SINGLE_ANNUAL]:  'Single Program — Annual',
  [import.meta.env.VITE_STRIPE_PRICE_SCHOOL_MONTHLY]: 'School — Monthly',
  [import.meta.env.VITE_STRIPE_PRICE_SCHOOL_ANNUAL]:  'School — Annual',
}

const STATUS_LABELS = {
  trialing:  { label: 'Free Trial',   color: '#cc8800', bg: '#1a0d00', border: '#3a2000' },
  active:    { label: 'Active',       color: '#66cc88', bg: '#001a00', border: '#003300' },
  past_due:  { label: 'Payment Due',  color: '#ff6666', bg: '#2a0000', border: '#6a0000' },
  canceled:  { label: 'Canceled',     color: '#9a8080', bg: '#1a0000', border: '#2a0000' },
}

export default function SettingsSection({ org, profile, orgColor, onOrgUpdate,
  subscription, onSubscriptionUpdate, onStartCheckout, checkoutLoading, checkoutError,
  // Multi-program props (Commit 2b). programCount is the live count of
  // organizations on the account — drives both the "Athletic Director"
  // vs "Head Coach" label decision AND whether the Add Program upgrade
  // dialog needs the AD designation step. onProgramCreated is the
  // notify-parent callback fired after a successful program insert.
  programCount = 1, onProgramCreated }) {
  const { user, loading: authLoading } = useAuth()

  const [form, setForm] = useState({
    name:             org?.name  ?? '',
    sport:            (org?.sport ?? '').toLowerCase(),
    primaryColor:     org?.primary_color   ?? '#cc1111',
    secondaryColor:   org?.secondary_color ?? '#ffffff',
    programNameColor: subscription?.program_name_color ?? '#ffffff',
  })
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveErr, setSaveErr] = useState('')

  const [coaches, setCoaches]         = useState([])
  // Edit-role inline state
  const [editingId,   setEditingId]   = useState(null)   // coach id being edited
  const [editRole,    setEditRole]    = useState('')      // draft role value
  const [savingRole,  setSavingRole]  = useState(false)
  // Remove confirmation
  const [removeId,    setRemoveId]    = useState(null)   // coach id pending removal
  const [removing,    setRemoving]    = useState(false)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName]   = useState('')
  const [inviteRole, setInviteRole]   = useState('assistant_coach')
  const [inviting, setInviting]       = useState(false)
  const [inviteSent, setInviteSent]   = useState('')   // success: shows the sent-to email
  const [inviteErr, setInviteErr]     = useState('')

  const [bgUploading, setBgUploading] = useState(false)
  const [bgError, setBgError]         = useState('')
  const [bgSuccess, setBgSuccess]     = useState(false)
  const bgInputRef = useRef(null)

  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError]         = useState('')
  const [logoSuccess, setLogoSuccess]     = useState(false)
  const logoInputRef = useRef(null)

  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError,   setPortalError]   = useState('')

  // Whether this account has 2+ programs. Decides whether 'ad' is labelled
  // "Athletic Director" (multi-program school) or "Head Coach" (single-
  // program account — the AD is also the de-facto HC). The DB value stays
  // 'ad' either way; this is purely a display decision. See roleLabel()
  // in src/lib/permissions.js. Source of truth is the parent's allOrgs
  // count (passed as programCount) — Commit 2b lifted this from the
  // section-local query so the value stays in sync after Add Program.
  const isMultiProgram = (programCount ?? 0) >= 2

  // ── Add Program dialog state ─────────────────────────────────────────────
  // Eligibility (button visibility) is computed at render time. Open state
  // is toggled by the button + the dialog's close handler.
  const [showAddProgram, setShowAddProgram] = useState(false)
  const canAddProgram =
    profile?.role === 'ad'
    || (profile?.role === 'head_coach' && programCount === 1)

  // Sync form whenever org or subscription changes (also covers initial load
  // when either arrives async).
  useEffect(() => {
    if (org?.id) {
      setForm({
        name:             org.name  ?? '',
        sport:            (org.sport ?? '').toLowerCase(),
        primaryColor:     org.primary_color   ?? '#cc1111',
        secondaryColor:   org.secondary_color ?? '#ffffff',
        programNameColor: subscription?.program_name_color ?? '#ffffff',
      })
      loadCoaches()
    }
  }, [org?.id, org?.name, org?.sport, org?.primary_color, org?.secondary_color, subscription?.id, subscription?.program_name_color])

  async function loadCoaches() {
    if (!org?.id) return
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('org_id', org.id)
      .order('full_name')
    setCoaches(data ?? [])
  }

  async function saveSettings() {
    if (!form.name.trim()) { setSaveErr('Program name is required.'); return }
    setSaving(true); setSaved(false); setSaveErr('')
    try {
      if (org?.id) {
        // ── Existing org: update ──────────────────────────────────────────────
        const { error: err } = await supabase
          .from('organizations')
          .update({
            name:            form.name.trim(),
            sport:           form.sport,
            primary_color:   form.primaryColor,
            secondary_color: form.secondaryColor,
          })
          .eq('id', org.id)
        if (err) { setSaveErr(err.message); return }

        // program_name_color lives on the accounts row, not organizations.
        // Skip when there's no subscription / accountId yet (e.g. legacy users
        // whose profile.account_id wasn't linked) — never block the org save.
        if (subscription?.id) {
          const { error: accErr } = await supabase
            .from('accounts')
            .update({ program_name_color: form.programNameColor })
            .eq('id', subscription.id)
          if (accErr) {
            // Non-blocking: surface but don't roll back the org update.
            console.warn('[Settings] program_name_color update failed:', accErr.message)
          } else {
            onSubscriptionUpdate?.({ ...subscription, program_name_color: form.programNameColor })
          }
        }

        setSaved(true)
        onOrgUpdate?.({
          ...org,
          name:            form.name.trim(),
          sport:           form.sport,
          primary_color:   form.primaryColor,
          secondary_color: form.secondaryColor,
        })
      } else {
        // ── No org yet: create org + profile (first-time setup) ──────────────
        const userId = user?.id
        if (!userId) { setSaveErr('Not signed in — please reload.'); return }

        // Generate org ID client-side so we don't need a SELECT-after-INSERT
        // (profile row doesn't exist yet, so org SELECT policies would block it)
        const orgId = crypto.randomUUID()
        const slug  = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now()

        // 1. Insert org (no .select() — avoids SELECT policy chicken-and-egg)
        const { error: orgErr } = await supabase
          .from('organizations')
          .insert({ id: orgId, name: form.name.trim(), sport: form.sport || 'football', slug, primary_color: '#cc1111', secondary_color: '#ffffff' })
        if (orgErr) { setSaveErr(`Could not create org: ${orgErr.message}`); return }

        // 2. Link profile to the new org
        const { error: profErr } = await supabase
          .from('profiles')
          .upsert({ id: userId, org_id: orgId, email: user?.email ?? '', role: 'head_coach', full_name: profile?.full_name ?? '' }, { onConflict: 'id' })
        if (profErr) { setSaveErr(`Could not link profile: ${profErr.message}`); return }

        setSaved(true)
        // Reload so Dashboard re-fetches everything with the new org
        setTimeout(() => window.location.reload(), 1200)
      }
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveErr(e.message ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function uploadBackground(e) {
    const file = e.target.files?.[0]
    if (!file) return

    // Guard: org must be loaded before we can save the URL
    if (!org?.id) {
      setBgError('Organization not loaded yet — please wait a moment and try again.')
      return
    }
    if (!file.type.startsWith('image/')) { setBgError('Please select an image file.'); return }
    if (file.size > 10 * 1024 * 1024) { setBgError('Image must be under 10 MB.'); return }

    setBgUploading(true); setBgError(''); setBgSuccess(false)

    // ── HOW TO CREATE THE BUCKET ────────────────────────────────────────────
    // 1. Go to Supabase → Storage → New bucket
    // 2. Name it exactly:  backgrounds
    // 3. Toggle "Public bucket" ON
    // 4. Click Create
    // ────────────────────────────────────────────────────────────────────────

    try {
      const ext  = file.name.split('.').pop()
      // Path convention: <org_id>/practice-bg.<ext>. Must match the
      // backgrounds bucket RLS (migration 20260517000000) which gates
      // writes on split_part(name,'/',1) = caller's profile.org_id (or
      // any org in the AD's account). The legacy `org-<uuid>/...` paths
      // from before this migration become write-orphans but are still
      // publicly readable via existing org.background_url values, so the
      // app keeps working — we just can't replace those exact files.
      const path = `${org.id}/practice-bg.${ext}`

      const { error: upErr } = await supabase.storage
        .from('backgrounds')
        .upload(path, file, { upsert: true, contentType: file.type })

      if (upErr) {
        const msg = upErr.message ?? ''
        setBgError(
          msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('bucket')
            ? 'Storage bucket "backgrounds" not found.\n\nTo fix: Supabase → Storage → New bucket → name it "backgrounds" → enable Public → Create.'
            : `Upload failed: ${msg}`
        )
        return
      }

      const { data: urlData } = supabase.storage.from('backgrounds').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) { setBgError('Could not get image URL. Check bucket public setting.'); return }

      const bgUrl = `${publicUrl}?v=${Date.now()}`

      const { error: dbErr } = await supabase
        .from('organizations')
        .update({ background_url: bgUrl })
        .eq('id', org.id)

      if (dbErr) {
        setBgError(`Upload failed: ${dbErr.message}`)
        return
      }

      setBgSuccess(true)
      onOrgUpdate?.({ ...org, background_url: bgUrl })
      setTimeout(() => setBgSuccess(false), 5000)
      if (bgInputRef.current) bgInputRef.current.value = ''
    } catch (err) {
      setBgError(err.message ?? 'Upload failed. Please try again.')
    } finally {
      setBgUploading(false)
    }
  }

  async function clearBackground() {
    if (!org?.id) return
    const { error } = await supabase
      .from('organizations')
      .update({ background_url: null })
      .eq('id', org.id)
    if (!error) onOrgUpdate?.({ ...org, background_url: null })
  }

  // ── Program logo upload ────────────────────────────────────────────────────
  // Stored in the existing `backgrounds` storage bucket so we don't need
  // a second bucket. Path convention is the same as the practice-bg image:
  // <org_id>/program-logo.<ext>. This matches the bucket RLS (migration
  // 20260517000000) which gates writes on split_part(name,'/',1) =
  // caller's profile.org_id. Legacy paths `logos/<uuid>/program-logo.<ext>`
  // from before this migration are write-orphans (publicly readable, but
  // can't be overwritten by anyone) — new uploads use the flat layout.
  async function uploadLogo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!org?.id) {
      setLogoError('Organization not loaded yet — please wait a moment and try again.')
      return
    }
    if (!file.type.startsWith('image/')) { setLogoError('Please select an image file.'); return }
    if (file.size > 5 * 1024 * 1024)     { setLogoError('Logo must be under 5 MB.');     return }

    setLogoUploading(true); setLogoError(''); setLogoSuccess(false)

    try {
      const ext  = file.name.split('.').pop()
      const path = `${org.id}/program-logo.${ext}`

      const { error: upErr } = await supabase.storage
        .from('backgrounds')
        .upload(path, file, { upsert: true, contentType: file.type })

      if (upErr) {
        setLogoError(`Upload failed: ${upErr.message ?? 'unknown error'}`)
        return
      }

      const { data: urlData } = supabase.storage.from('backgrounds').getPublicUrl(path)
      const publicUrl = urlData?.publicUrl
      if (!publicUrl) { setLogoError('Could not get logo URL.'); return }

      const cacheBusted = `${publicUrl}?v=${Date.now()}`

      const { error: dbErr } = await supabase
        .from('organizations')
        .update({ logo_url: cacheBusted })
        .eq('id', org.id)

      if (dbErr) { setLogoError(`Upload failed: ${dbErr.message}`); return }

      setLogoSuccess(true)
      onOrgUpdate?.({ ...org, logo_url: cacheBusted })
      setTimeout(() => setLogoSuccess(false), 5000)
      if (logoInputRef.current) logoInputRef.current.value = ''
    } catch (err) {
      setLogoError(err.message ?? 'Upload failed. Please try again.')
    } finally {
      setLogoUploading(false)
    }
  }

  async function clearLogo() {
    if (!org?.id) return
    const { error } = await supabase
      .from('organizations')
      .update({ logo_url: null })
      .eq('id', org.id)
    if (!error) onOrgUpdate?.({ ...org, logo_url: null })
  }

  function startEditRole(coach) {
    setEditingId(coach.id)
    setEditRole(coach.role)
  }

  async function saveRole() {
    if (!editingId) return
    setSavingRole(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: editRole })
        .eq('id', editingId)
      if (error) throw error
      setEditingId(null)
      await loadCoaches()
    } catch (err) {
      console.error('[Settings] saveRole error:', err.message)
    } finally {
      setSavingRole(false)
    }
  }

  async function confirmRemove() {
    if (!removeId) return
    setRemoving(true)
    try {
      // Delete the profile row — removes org access.
      // Their Supabase auth account remains (they can still sign in but
      // will have no profile / org and be treated as a new user).
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', removeId)
      if (error) throw error
      setRemoveId(null)
      await loadCoaches()
    } catch (err) {
      console.error('[Settings] removeCoach error:', err.message)
    } finally {
      setRemoving(false)
    }
  }

  async function handleInvite(e) {
    e.preventDefault()
    if (!inviteEmail.trim() || !org?.id) return
    setInviting(true); setInviteSent(''); setInviteErr('')

    try {
      // P0 security fix (2026-05-15): /api/invite-coach now requires a
      // valid Supabase JWT in the Authorization header. The endpoint
      // verifies the caller server-side, looks up their profile, and
      // only allows the invite when the caller has role ∈ {ad,head_coach}
      // AND the org_id matches their own. Without this header the
      // endpoint returns 401.
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token ?? null
      if (!accessToken) {
        throw new Error('Your session has expired — please sign in again.')
      }

      const res = await fetch('/api/invite-coach', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body:    JSON.stringify({
          email:  inviteEmail.trim(),
          name:   inviteName.trim() || null,
          role:   inviteRole,
          org_id: org.id,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`)

      setInviteSent(inviteEmail.trim())
      setInviteEmail('')
      setInviteName('')
    } catch (err) {
      setInviteErr(err.message ?? 'Could not send invite.')
    } finally {
      setInviting(false)
    }
  }

  async function openBillingPortal() {
    const customerId = subscription?.stripe_customer_id
    if (!customerId) return
    setPortalLoading(true)
    setPortalError('')
    try {
      const res = await fetch('/api/stripe-portal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customerId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Portal session failed')
      window.location.href = data.url
    } catch (err) {
      setPortalError(err.message ?? 'Could not open billing portal.')
      setPortalLoading(false)
    }
  }

  function upd(key, val) { setForm(f => ({ ...f, [key]: val })) }

  const inputStyle = { backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#fff' }

  // ── Loading guard ────────────────────────────────────────────────────────────
  // Spin only while auth is actively loading. Once done, always show the form —
  // if org is null the user will fill in their details and we'll create it on Save.
  if (!org && authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 animate-spin"
            style={{ borderColor: orgColor, borderTopColor: 'transparent' }}
          />
          <p className="text-sm" style={{ color: '#9a8080' }}>Loading settings…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5 items-start">

        {/* ── LEFT COLUMN ── */}
        <div className="flex flex-col gap-5">

          {/* Program Settings — ad/head_coach only. Aligns with the RLS
              gate on organizations UPDATE (P0 migration 20260515000000,
              renamed in 20260516000000). A team_manager or assistant_coach
              would have the inputs render but every save would bounce off
              RLS, so we hide the whole card. */}
          {canManageCoaches(profile?.role) && (
          <Section title="Program Settings">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#9a8080' }}>
                Program Name
              </label>
              <input
                value={form.name}
                onChange={e => upd('name', e.target.value)}
                placeholder="Albertville Aggies Football"
                className="rounded-lg px-4 py-3 text-sm outline-none"
                style={inputStyle}
              />
              <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
                Your program name appears at the top of the dashboard and on the scoreboard team labels.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#9a8080' }}>Sport</label>
              <select
                value={form.sport}
                onChange={e => upd('sport', e.target.value)}
                className="rounded-lg px-4 py-3 text-sm outline-none"
                style={inputStyle}
              >
                <option value="">Select sport…</option>
                {SPORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Color pickers */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                {[
                  { key: 'primaryColor',   label: 'Primary Color' },
                  { key: 'secondaryColor', label: 'Secondary Color' },
                ].map(({ key, label }) => (
                  <div key={key} className="flex-1 flex flex-col gap-1">
                    <label className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#9a8080' }}>
                      {label}
                    </label>
                    <div
                      className="flex items-center gap-2 rounded-lg px-3 py-2"
                      style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000' }}
                    >
                      <input
                        type="color"
                        value={form[key]}
                        onChange={e => upd(key, e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer shrink-0"
                        style={{ backgroundColor: 'transparent', border: '1px solid #3a0000', padding: '1px' }}
                      />
                      <span className="text-xs font-mono" style={{ color: '#9a8080' }}>
                        {form[key]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Program name color — saved to accounts.program_name_color */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#9a8080' }}>
                  Program Name Color
                </label>
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000' }}
                >
                  <input
                    type="color"
                    value={form.programNameColor}
                    onChange={e => upd('programNameColor', e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer shrink-0"
                    style={{ backgroundColor: 'transparent', border: '1px solid #3a0000', padding: '1px' }}
                  />
                  <span className="text-xs font-mono" style={{ color: '#9a8080' }}>
                    {form.programNameColor}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
                  This is the color of your program name shown at the top of the dashboard.
                </p>
              </div>
            </div>

            {/* Live preview */}
            <div
              className="flex items-center justify-center rounded-lg px-4 py-3 text-sm font-bold"
              style={{
                backgroundColor: form.primaryColor,
                color:           form.secondaryColor,
                border:          '1px solid #2a0000',
              }}
            >
              {form.name.trim() || 'Program Name Preview'}
            </div>

            {saveErr && (
              <p className="text-xs text-center rounded-lg px-3 py-2" style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                {saveErr}
              </p>
            )}
            <button
              onClick={saveSettings}
              disabled={saving}
              className="py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-colors"
              style={{ backgroundColor: saved ? '#22c55e' : orgColor }}
            >
              {saving ? 'Saving…' : saved ? '✓ Saved!' : org?.id ? 'Save Changes' : 'Create Program'}
            </button>
          </Section>
          )}

          {/* Program Logo — ad+head_coach only (same gating as Coaches & Staff) */}
          {canManageCoaches(profile?.role) && (
          <Section title="Program Logo">
            <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
              Optional. Appears next to your program name in the dashboard header
              and on printed practice scripts. PNG or JPG with a transparent
              background works best (under 5 MB).
            </p>

            {org?.logo_url && (
              <div className="relative rounded-xl overflow-hidden flex items-center justify-center"
                style={{ aspectRatio: '4/1', backgroundColor: '#1a0000', border: '1px solid #2a0000' }}>
                <img
                  src={org.logo_url}
                  alt="Program logo"
                  className="max-w-full max-h-full object-contain p-3"
                />
                <div className="absolute inset-0 flex items-end p-3 justify-end pointer-events-none">
                  <button
                    onClick={clearLogo}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold pointer-events-auto"
                    style={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid #cc1111', color: '#cc1111' }}
                  >
                    ✕ Remove
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <input ref={logoInputRef} type="file" accept="image/*" onChange={uploadLogo} className="hidden" id="logo-upload" />
              <label
                htmlFor="logo-upload"
                className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold cursor-pointer transition-all"
                style={{
                  border:          `2px dashed ${logoUploading ? orgColor : '#2a0000'}`,
                  color:           logoUploading ? orgColor : '#9a8080',
                  backgroundColor: '#1a0000',
                  pointerEvents:   logoUploading ? 'none' : 'auto',
                }}
              >
                {logoUploading
                  ? <><span className="animate-spin inline-block">⟳</span> Uploading…</>
                  : <>🏷️ {org?.logo_url ? 'Replace Logo' : 'Upload Program Logo'}</>
                }
              </label>

              {logoError && (
                <p className="text-xs rounded-lg px-3 py-2 leading-relaxed whitespace-pre-line"
                  style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                  {logoError}
                </p>
              )}
              {logoSuccess && (
                <p className="text-xs rounded-lg px-3 py-2"
                  style={{ backgroundColor: '#001a00', color: '#66cc88', border: '1px solid #003300' }}>
                  ✓ Logo updated
                </p>
              )}
            </div>
          </Section>
          )}

          {/* Practice Background — ad/head_coach only. Same logic as
              Program Settings + Program Logo. */}
          {canManageCoaches(profile?.role) && (
          <Section title="Practice Screen Background">
            <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
              Upload an image that appears behind the clock on the Practice screen.
              Use a{' '}
              <span className="font-semibold text-white">landscape image at least 1366 × 1024 px</span>
              {' '}(JPG or PNG, max 10 MB). A darker image works best.
            </p>

            {org?.background_url && (
              <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
                <img
                  src={org.background_url}
                  alt="Practice background"
                  className="w-full h-full object-cover"
                  style={{ opacity: 0.7 }}
                />
                <div className="absolute inset-0 flex items-end p-3 justify-end">
                  <button
                    onClick={clearBackground}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid #cc1111', color: '#cc1111' }}
                  >
                    ✕ Remove
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <input ref={bgInputRef} type="file" accept="image/*" onChange={uploadBackground} className="hidden" id="bg-upload" />
              <label
                htmlFor="bg-upload"
                className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold cursor-pointer transition-all"
                style={{
                  border:          `2px dashed ${bgUploading ? orgColor : '#2a0000'}`,
                  color:           bgUploading ? orgColor : '#9a8080',
                  backgroundColor: '#1a0000',
                  pointerEvents:   bgUploading ? 'none' : 'auto',
                }}
              >
                {bgUploading
                  ? <><span className="animate-spin inline-block">⟳</span> Uploading…</>
                  : <>📸 {org?.background_url ? 'Replace Background Image' : 'Upload Background Image'}</>
                }
              </label>

              {bgError && (
                <p className="text-xs rounded-lg px-3 py-2 leading-relaxed whitespace-pre-line"
                  style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                  {bgError}
                </p>
              )}
              {bgSuccess && (
                <p className="text-xs rounded-lg px-3 py-2 font-semibold"
                  style={{ backgroundColor: '#001a00', color: '#66cc88' }}>
                  ✓ Background updated! Switch to the Practice tab to see it.
                </p>
              )}
            </div>

            {/* dev setup notes removed — see file header comment */}
          </Section>
          )}
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="flex flex-col gap-5">

          {/* Programs — multi-program management for AD and the head-coach
              upgrade entry point. Hidden for assistant_coach/team_manager.
              For an AD on a multi-program account, this card also lists
              the existing programs so they can see what's in scope at a
              glance. */}
          {canAddProgram && (
            <Section title="Programs">
              {programCount > 1 && (
                <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
                  Your school has{' '}
                  <span className="font-semibold text-white">{programCount} programs</span>.
                  Use the program switcher in the header to move between
                  them. Add another program below.
                </p>
              )}
              {programCount === 1 && profile?.role === 'head_coach' && (
                <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
                  Want to run a second program from the same account
                  (e.g. football + basketball)? Add a program and we'll
                  walk you through the Athletic Director designation.
                </p>
              )}
              {programCount === 1 && profile?.role === 'ad' && (
                <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
                  You can run multiple programs from this one account.
                  Add another program below — for example, a different
                  sport or a junior-varsity team.
                </p>
              )}
              <button
                onClick={() => setShowAddProgram(true)}
                className="flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: orgColor }}
              >
                + Add Program
              </button>
            </Section>
          )}

          {/* Coaches & Staff — ad, head_coach, and legacy accounts with no role */}
          {canManageCoaches(profile?.role) && (
            <Section title="Coaches & Staff">
              {/* ── Coach rows ── */}
              {coaches.length === 0 ? (
                <p className="text-sm" style={{ color: '#9a8080' }}>No coaches found for this org.</p>
              ) : (
                <div className="flex flex-col divide-y" style={{ '--tw-divide-opacity': 1 }}>
                  {coaches.map((c, i) => {
                    const isSelf    = c.id === user?.id
                    const isEditing = editingId === c.id

                    return (
                      <div
                        key={c.id}
                        className="flex flex-col gap-2 py-3"
                        style={{ borderTop: i === 0 ? 'none' : '1px solid #1a0000' }}
                      >
                        {/* Top row: name + email + badge + actions */}
                        <div className="flex items-center gap-2">
                          {/* Identity */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-white truncate">
                                {c.full_name || '—'}
                                {isSelf && (
                                  <span className="ml-1.5 text-xs font-normal" style={{ color: '#9a8080' }}>(you)</span>
                                )}
                              </p>
                              {!isEditing && <RoleBadge role={c.role} isMultiProgram={isMultiProgram} />}
                            </div>
                            <p className="text-xs truncate" style={{ color: '#9a8080' }}>{c.email}</p>
                          </div>

                          {/* Action buttons — not shown while editing.
                              Visibility is gated by canRemoveCoach() /
                              canEditCoachRole() in src/lib/permissions.js —
                              the RLS in migration 20260518000000 is the
                              actual security boundary, these helpers just
                              keep the UI honest so a head_coach doesn't
                              tap a button that's going to bounce off RLS
                              with a confusing error. Notably: head_coach
                              never sees Remove/Edit-role on the AD's row,
                              and assistant_coach / team_manager never see
                              either button anywhere. */}
                          {!isEditing && (() => {
                            const canEdit   = canEditCoachRole(profile, c)
                            const canRemove = canRemoveCoach(profile, c)
                            if (!canEdit && !canRemove) return null
                            return (
                              <div className="flex gap-1.5 shrink-0">
                                {canEdit && (
                                  <button
                                    onClick={() => startEditRole(c)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                    style={{ border: '1px solid #2a0000', color: '#9a8080' }}
                                  >
                                    Edit role
                                  </button>
                                )}
                                {canRemove && (
                                  <button
                                    onClick={() => setRemoveId(c.id)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                    style={{ border: '1px solid #3a0000', color: '#cc4444' }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            )
                          })()}
                        </div>

                        {/* Inline edit-role row */}
                        {isEditing && (
                          <div className="flex items-center gap-2 pl-0">
                            <select
                              value={editRole}
                              onChange={e => setEditRole(e.target.value)}
                              className="flex-1 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                              style={{ backgroundColor: '#1a0000', border: '1px solid #3a0000', color: '#fff' }}
                            >
                              {ROLES.map(r => (
                                <option key={r} value={r}>{roleLabel(r, isMultiProgram)}</option>
                              ))}
                            </select>
                            <button
                              onClick={saveRole}
                              disabled={savingRole}
                              className="px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50 shrink-0"
                              style={{ backgroundColor: orgColor }}
                            >
                              {savingRole ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              disabled={savingRole}
                              className="px-3 py-2 rounded-lg text-xs font-semibold shrink-0"
                              style={{ border: '1px solid #2a0000', color: '#9a8080' }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── Invite form ── */}
              <form onSubmit={handleInvite} className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid #2a0000' }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9a8080' }}>Invite Coach</p>

                <input
                  type="text"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="Coach full name (optional)"
                  className="rounded-lg px-3 py-3 text-sm outline-none"
                  style={inputStyle}
                />

                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="coach@school.edu"
                    className="flex-1 rounded-lg px-3 py-3 text-sm outline-none"
                    style={inputStyle}
                  />
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value)}
                    className="rounded-lg px-2 py-3 text-xs font-bold outline-none"
                    style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#fff' }}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{roleLabel(r, isMultiProgram)}</option>)}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={inviting}
                  className="py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: orgColor }}
                >
                  {inviting ? 'Sending…' : 'Send Invite'}
                </button>

                {inviteErr && (
                  <p className="text-xs p-3 rounded-lg" style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                    {inviteErr}
                  </p>
                )}

                {inviteSent && (
                  <div className="p-3 rounded-lg" style={{ backgroundColor: '#001a00', border: '1px solid #003300' }}>
                    <p className="text-xs font-semibold" style={{ color: '#66cc88' }}>
                      ✓ Invite sent to {inviteSent}
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#9a9a9a' }}>
                      They'll receive an email with a link to set their password and join your program.
                    </p>
                  </div>
                )}
              </form>
            </Section>
          )}

          {/* ── Billing — ad only ──────────────────────────────────────────
              head_coach manages coaches/staff but should not see or touch
              billing. assistant_coach / team_manager should never see this
              card. Matches the RLS gate on accounts UPDATE (get_my_role()
              = 'ad'). */}
          {profile?.role === 'ad' && (
          <Section title="Subscription & Billing">
            {(() => {
              const sub      = subscription
              const status   = sub?.status ?? null
              const trialEnd = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null
              const now      = new Date()
              const daysLeft = trialEnd ? Math.ceil((trialEnd - now) / 86400000) : null
              const trialExpired = trialEnd && trialEnd < now && status !== 'active'
              const hasStripe = !!(sub?.stripe_customer_id)
              const statusMeta = STATUS_LABELS[status] ?? STATUS_LABELS.canceled

              // ── No account row yet (shouldn't normally happen) ────────────
              if (!sub) {
                return (
                  <p className="text-sm" style={{ color: '#9a8080' }}>
                    Account not found. Please reload or contact support.
                  </p>
                )
              }

              // ── Active trial ───────────────────────────────────────────────
              if (status === 'trialing' && !trialExpired) {
                const trialEndFmt = trialEnd?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-widest" style={{ color: '#4a2020' }}>Status</span>
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: statusMeta.bg, color: statusMeta.color, border: `1px solid ${statusMeta.border}` }}>
                          {statusMeta.label}
                        </span>
                      </div>
                      {daysLeft !== null && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs uppercase tracking-widest" style={{ color: '#4a2020' }}>Days left</span>
                          <span className="text-sm font-semibold" style={{ color: daysLeft <= 3 ? '#f59e0b' : '#fff' }}>
                            {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'Expires today'}
                          </span>
                        </div>
                      )}
                      {trialEndFmt && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs uppercase tracking-widest" style={{ color: '#4a2020' }}>Trial ends</span>
                          <span className="text-sm text-white">{trialEndFmt}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid #2a0000' }}>
                      <p className="text-xs" style={{ color: '#9a8080' }}>
                        Subscribe now to keep access after your trial. Your card won't be charged until the trial ends.
                      </p>
                      <button
                        onClick={() => onStartCheckout?.()}
                        disabled={checkoutLoading}
                        className="py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                        style={{ backgroundColor: orgColor }}
                      >
                        {checkoutLoading ? 'Loading…' : 'Subscribe →'}
                      </button>
                      {checkoutError && (
                        <p className="text-xs p-2 rounded-lg leading-relaxed"
                          style={{ backgroundColor: '#2a0000', color: '#ff6666', border: '1px solid #4a0000' }}>
                          ⚠ {checkoutError}
                        </p>
                      )}
                    </div>
                  </div>
                )
              }

              // ── Active subscription ────────────────────────────────────────
              if (status === 'active') {
                const planLabel = PRICE_LABELS[sub.price_id] ?? (
                  sub.plan_type === 'school' ? 'School — All Programs' : 'Single Program'
                )
                const isSingle = sub.plan_type !== 'school'
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-widest" style={{ color: '#4a2020' }}>Plan</span>
                        <span className="text-sm font-semibold text-white">{planLabel}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-widest" style={{ color: '#4a2020' }}>Status</span>
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: statusMeta.bg, color: statusMeta.color, border: `1px solid ${statusMeta.border}` }}>
                          {statusMeta.label}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid #2a0000' }}>
                      {hasStripe && (
                        <button
                          onClick={openBillingPortal}
                          disabled={portalLoading}
                          className="py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                          style={{ backgroundColor: orgColor }}
                        >
                          {portalLoading ? 'Opening…' : 'Manage Billing'}
                        </button>
                      )}
                      {isSingle && (
                        <button
                          onClick={() => onStartCheckout?.()}
                          disabled={checkoutLoading}
                          className="py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                          style={{ border: `2px solid ${orgColor}`, backgroundColor: 'transparent', color: orgColor }}
                        >
                          {checkoutLoading ? 'Loading…' : 'Upgrade to School Plan'}
                        </button>
                      )}
                      {portalError && (
                        <p className="text-xs p-2 rounded-lg" style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                          {portalError}
                        </p>
                      )}
                      {checkoutError && (
                        <p className="text-xs p-2 rounded-lg leading-relaxed"
                          style={{ backgroundColor: '#2a0000', color: '#ff6666', border: '1px solid #4a0000' }}>
                          ⚠ {checkoutError}
                        </p>
                      )}
                    </div>
                  </div>
                )
              }

              // ── Trial expired, canceled, or past_due ───────────────────────
              const msg = status === 'past_due'
                ? "Your last payment didn't go through."
                : trialExpired
                  ? 'Your free trial has ended.'
                  : 'Your subscription has ended.'

              return (
                <div className="flex flex-col gap-3">
                  <p className="text-sm" style={{ color: '#9a8080' }}>{msg} Subscribe to restore access.</p>
                  <button
                    onClick={() => onStartCheckout?.()}
                    disabled={checkoutLoading}
                    className="py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                    style={{ backgroundColor: orgColor }}
                  >
                    {checkoutLoading ? 'Loading…' : 'Subscribe →'}
                  </button>
                  {hasStripe && status === 'past_due' && (
                    <button
                      onClick={openBillingPortal}
                      disabled={portalLoading}
                      className="py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
                      style={{ border: `1px solid #2a0000`, backgroundColor: 'transparent', color: '#9a8080' }}
                    >
                      {portalLoading ? 'Opening…' : 'Update Payment Method'}
                    </button>
                  )}
                  {(checkoutError || portalError) && (
                    <p className="text-xs p-2 rounded-lg leading-relaxed"
                      style={{ backgroundColor: '#2a0000', color: '#ff6666', border: '1px solid #4a0000' }}>
                      ⚠ {checkoutError || portalError}
                    </p>
                  )}
                </div>
              )
            })()}
          </Section>
          )}

          {/* Account info */}
          <Section title="Your Account">
            <div className="flex flex-col gap-3">
              {[
                { label: 'Name',  value: profile?.full_name, capitalize: true  },
                { label: 'Email', value: profile?.email,     capitalize: false },
                // Role uses the friendly label (e.g. "Athletic Director")
                // rather than the raw DB value ('ad'). The roleLabel helper
                // already returns Title Case, so don't apply CSS capitalize
                // (which would otherwise hyper-capitalise "Athletic Director"
                // → "Athletic Director" — fine — but also "head_coach" →
                // "Head_Coach" if the label ever fell through to the raw
                // value defensively).
                { label: 'Role',  value: roleLabel(profile?.role, isMultiProgram), capitalize: false },
              ].map(({ label, value, capitalize }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-xs uppercase tracking-widest" style={{ color: '#4a2020' }}>{label}</span>
                  <span className={`text-sm font-semibold text-white ${capitalize ? 'capitalize' : ''}`}>{value || '—'}</span>
                </div>
              ))}
            </div>
          </Section>

        </div>
      </div>

      {/* ── Remove coach confirmation modal ── */}
      {removeId && (() => {
        const coach = coaches.find(c => c.id === removeId)
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}
          >
            <div
              className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
              style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
            >
              <h3 className="font-bold text-white text-lg">Remove coach?</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
                Remove{' '}
                <span className="font-semibold text-white">
                  {coach?.full_name || coach?.email || 'this coach'}
                </span>{' '}
                from your program? They will lose access immediately.
              </p>
              <p className="text-xs" style={{ color: '#4a2020' }}>
                Their account is not deleted — they just lose access to this org.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setRemoveId(null)}
                  disabled={removing}
                  className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ border: '1px solid #2a0000', color: '#9a8080' }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRemove}
                  disabled={removing}
                  className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#cc1111' }}
                >
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Add Program dialog ── */}
      <AddProgramDialog
        open={showAddProgram}
        onClose={() => setShowAddProgram(false)}
        onCreated={(orgId, opts) => {
          // Parent (Dashboard) refetches allOrgs + (if promoted) the
          // caller's profile + switches active context to the new
          // program. We just need to close the dialog.
          onProgramCreated?.(orgId, opts)
          setShowAddProgram(false)
        }}
        callerRole={profile?.role}
        currentProgramCount={programCount}
        orgColor={orgColor}
        sports={SPORTS}
      />
    </div>
  )
}
