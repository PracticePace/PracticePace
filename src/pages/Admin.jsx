// ── Admin — /admin ────────────────────────────────────────────────────────────
// Owner-only business dashboard. Was a three-line stub.
//
// ACCESS IS A 404, NOT A LOCKED DOOR.
// This page holds no secrets of its own — every number comes from
// /api/admin-stats, which verifies the caller's Supabase JWT against
// ADMIN_EMAILS server-side and answers 404 to everyone else. The service-role
// key never reaches the browser. When that endpoint 404s, this renders the
// ordinary marketing 404, so /admin is indistinguishable from a mistyped URL
// for anyone who isn't an owner. There is nothing here to bypass: hiding the
// UI is cosmetic, the endpoint is the gate.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import NotFoundPage from './NotFoundPage'
import Logo from '../components/Logo'

const RED = '#cc1111'

// ── Formatting ───────────────────────────────────────────────────────────────
const usd = cents => cents == null
  ? '—'
  : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const shortDate = iso => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

const pct = n => (n == null ? '—' : `${n}%`)

// ── Shell pieces ─────────────────────────────────────────────────────────────

function Panel({ title, subtitle, children, right }) {
  return (
    <section className="flex flex-col gap-4 p-5 rounded-2xl"
      style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-bold text-white text-base">{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: '#6a4040' }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function Card({ label, value, hint, tone = 'default' }) {
  const color = tone === 'bad' ? '#ff6666' : tone === 'good' ? '#66cc88' : '#ffffff'
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl"
      style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000' }}>
      <span className="text-xs uppercase tracking-widest" style={{ color: '#6a4040' }}>{label}</span>
      <span className="text-2xl font-black" style={{ color }}>{value}</span>
      {hint && <span className="text-xs leading-snug" style={{ color: '#4a2020' }}>{hint}</span>}
    </div>
  )
}

function Pill({ children, tone = 'muted' }) {
  const map = {
    good:  { bg: '#001a00', fg: '#66cc88', bd: '#003300' },
    bad:   { bg: '#2a0000', fg: '#ff6666', bd: '#6a0000' },
    warn:  { bg: '#1a0d00', fg: '#cc8800', bd: '#3a2000' },
    muted: { bg: '#1a0000', fg: '#9a8080', bd: '#2a0000' },
  }[tone]
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: map.bg, color: map.fg, border: `1px solid ${map.bd}` }}>
      {children}
    </span>
  )
}

const statusTone = s =>
  s === 'active' || s === 'complimentary' ? 'good'
  : s === 'past_due' || s === 'canceled'  ? 'bad'
  : s === 'trialing'                      ? 'warn' : 'muted'

function Empty({ children }) {
  return <p className="text-sm py-2" style={{ color: '#4a2020' }}>{children}</p>
}

// ── 12-week chart ────────────────────────────────────────────────────────────
// Inline SVG rather than a charting dependency: two series, twelve buckets,
// no interaction beyond a tooltip. A library would be more bytes than the
// whole page.
function WeeklyChart({ weeks }) {
  const max = Math.max(1, ...weeks.flatMap(w => [w.signups, w.paid]))
  const H = 150, BAR = 9, GAP = 4, GROUP = BAR * 2 + GAP, SLOT = 44
  const W = weeks.length * SLOT

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 text-xs" style={{ color: '#9a8080' }}>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, backgroundColor: '#6a4040', borderRadius: 2 }} /> Sign-ups
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, backgroundColor: RED, borderRadius: 2 }} /> New paid
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg width={W} height={H + 26} role="img"
             aria-label="New sign-ups and new paid accounts per week, last 12 weeks">
          {[0.25, 0.5, 0.75, 1].map(f => (
            <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f}
                  stroke="#2a0000" strokeWidth="1" />
          ))}
          {weeks.map((w, i) => {
            const x  = i * SLOT + (SLOT - GROUP) / 2
            const hs = Math.round((w.signups / max) * (H - 8))
            const hp = Math.round((w.paid    / max) * (H - 8))
            const label = new Date(w.start).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
            return (
              <g key={w.start}>
                <rect x={x} y={H - hs} width={BAR} height={hs} fill="#6a4040" rx="2">
                  <title>{`Week of ${label}: ${w.signups} sign-ups`}</title>
                </rect>
                <rect x={x + BAR + GAP} y={H - hp} width={BAR} height={hp} fill={RED} rx="2">
                  <title>{`Week of ${label}: ${w.paid} new paid`}</title>
                </rect>
                <text x={i * SLOT + SLOT / 2} y={H + 17} textAnchor="middle"
                      fontSize="10" fill="#6a4040">{label}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ── Account table ────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'name',        label: 'Account',     get: r => r.name },
  { key: 'ownerEmail',  label: 'Owner',       get: r => r.ownerEmail ?? '' },
  { key: 'planTier',    label: 'Plan',        get: r => r.planTier ?? '' },
  { key: 'status',      label: 'Status',      get: r => r.status ?? '' },
  { key: 'renewal',     label: 'Trial / renewal', get: r => r.trialEndsAt ?? r.renewalAt ?? '' },
  { key: 'programs',    label: 'Programs',    get: r => r.programs,  num: true },
  { key: 'coaches',     label: 'Coaches',     get: r => r.coaches,   num: true },
  { key: 'lastSignIn',  label: 'Last sign-in', get: r => r.lastSignIn ?? '' },
  { key: 'promoCode',   label: 'Code',        get: r => r.promoCode ?? '' },
  { key: 'createdAt',   label: 'Created',     get: r => r.createdAt ?? '' },
]

function AccountTable({ rows }) {
  const [q, setQ]       = useState('')
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' })

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = r => !needle || [
      r.name, r.ownerEmail, r.ownerName, r.planTier, r.status, r.promoCode,
    ].some(v => String(v ?? '').toLowerCase().includes(needle))

    const col = COLUMNS.find(c => c.key === sort.key) ?? COLUMNS[0]
    return rows.filter(match).sort((a, b) => {
      const av = col.get(a), bv = col.get(b)
      const cmp = col.num
        ? (Number(av) || 0) - (Number(bv) || 0)
        : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, q, sort])

  const toggle = key =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  // CSV of what is on screen — the filtered, sorted set, not the raw list.
  // Exporting something different from what the owner is looking at is a
  // surprise waiting to happen.
  function exportCsv() {
    const header = ['Account', 'Owner email', 'Owner name', 'Plan', 'Status',
      'Trial ends', 'Renews', 'Programs', 'Coaches', 'Last sign-in',
      'Promo code', 'Discount', 'Created']
    const esc = v => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = filtered.map(r => [
      r.name, r.ownerEmail, r.ownerName, r.planTier, r.status,
      r.trialEndsAt ? r.trialEndsAt.slice(0, 10) : '',
      r.renewalAt   ? r.renewalAt.slice(0, 10)   : '',
      r.programs, r.coaches,
      r.lastSignIn  ? r.lastSignIn.slice(0, 10)  : '',
      r.promoCode, r.discountCents == null ? '' : (r.discountCents / 100).toFixed(2),
      r.createdAt   ? r.createdAt.slice(0, 10)   : '',
    ].map(esc).join(','))

    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `practicepace-accounts-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel
      title="Accounts"
      subtitle={`${filtered.length} of ${rows.length}`}
      right={
        <div className="flex items-center gap-2 shrink-0">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name, email, code…"
            className="px-3 py-1.5 rounded-lg text-sm outline-none"
            style={{ backgroundColor: '#1a0000', border: '1px solid #2a0000', color: '#fff', minWidth: 210 }}
          />
          <button onClick={exportCsv}
            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white whitespace-nowrap"
            style={{ backgroundColor: RED }}>
            Export CSV
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {COLUMNS.map(c => (
                <th key={c.key} onClick={() => toggle(c.key)}
                  className="text-left px-2 py-2 cursor-pointer select-none whitespace-nowrap"
                  style={{ color: sort.key === c.key ? '#fff' : '#6a4040',
                           borderBottom: '1px solid #2a0000', fontSize: '0.72rem',
                           textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #1a0000' }}>
                <td className="px-2 py-2 text-white whitespace-nowrap">{r.name}</td>
                <td className="px-2 py-2 whitespace-nowrap" style={{ color: '#9a8080' }}>{r.ownerEmail ?? '—'}</td>
                <td className="px-2 py-2 whitespace-nowrap" style={{ color: '#9a8080' }}>{r.planTier ?? '—'}</td>
                <td className="px-2 py-2"><Pill tone={statusTone(r.status)}>{r.status ?? '—'}</Pill></td>
                <td className="px-2 py-2 whitespace-nowrap" style={{ color: '#9a8080' }}>
                  {r.status === 'trialing' ? shortDate(r.trialEndsAt) : shortDate(r.renewalAt)}
                </td>
                <td className="px-2 py-2 text-white">{r.programs}</td>
                <td className="px-2 py-2 text-white">{r.coaches}</td>
                <td className="px-2 py-2 whitespace-nowrap" style={{ color: '#9a8080' }}>{shortDate(r.lastSignIn)}</td>
                <td className="px-2 py-2 whitespace-nowrap" style={{ color: r.promoCode ? '#88cc44' : '#4a2020' }}>
                  {r.promoCode ?? '—'}
                </td>
                <td className="px-2 py-2 whitespace-nowrap" style={{ color: '#9a8080' }}>{shortDate(r.createdAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={COLUMNS.length}><Empty>No accounts match that search.</Empty></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ── Discount codes ───────────────────────────────────────────────────────────

const BLANK_CODE = { code: '', kind: 'percent', amount: '', maxRedemptions: '1', expiresAt: '', note: '' }

function CodeManager({ token }) {
  const [codes,   setCodes]   = useState(null)
  const [form,    setForm]    = useState(BLANK_CODE)
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  const [copied,  setCopied]  = useState(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/admin-codes', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not load codes.')
      setCodes(data.codes ?? [])
    } catch (e) { setErr(e.message); setCodes([]) }
  }, [token])

  // Kicked off a tick after commit, with the timer cleared on unmount. Two
  // reasons: a dashboard that mounts and immediately unmounts (a mistyped URL,
  // a fast back-button) never starts the request at all, and the fetch stays
  // out of the commit phase instead of cascading a render.
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function post(body) {
    setBusy(true); setErr('')
    try {
      const res  = await fetch('/api/admin-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      await load()
      return true
    } catch (e) { setErr(e.message); return false }
    finally { setBusy(false) }
  }

  async function create(e) {
    e.preventDefault()
    const ok = await post({
      action: 'create',
      code: form.code, kind: form.kind, amount: Number(form.amount),
      maxRedemptions: form.maxRedemptions, expiresAt: form.expiresAt || null,
      note: form.note,
    })
    if (ok) setForm(BLANK_CODE)
  }

  function copyLink(code) {
    const url = `https://www.practicepace.app/pricing?code=${encodeURIComponent(code)}`
    navigator.clipboard?.writeText(url)
      .then(() => { setCopied(code); setTimeout(() => setCopied(null), 1800) })
      .catch(() => setErr('Could not copy — the link is ' + url))
  }

  const input = {
    backgroundColor: '#1a0000', border: '1px solid #2a0000',
    color: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: '0.85rem',
  }

  return (
    <Panel title="Discount codes" subtitle="Stripe coupon + promotion code, applied once on the first invoice">
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: '#6a4040' }}>Code</span>
          <input required value={form.code} placeholder="COACHFRIEND"
            onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            style={{ ...input, width: 150, letterSpacing: '0.05em' }} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: '#6a4040' }}>Type</span>
          <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
            style={{ ...input, width: 100 }}>
            <option value="percent">% off</option>
            <option value="amount">$ off</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: '#6a4040' }}>Amount</span>
          <input required type="number" min="1" step="any" value={form.amount}
            placeholder={form.kind === 'percent' ? '25' : '100'}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            style={{ ...input, width: 90 }} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: '#6a4040' }}>Max uses</span>
          <input type="number" min="1" step="1" value={form.maxRedemptions}
            onChange={e => setForm(f => ({ ...f, maxRedemptions: e.target.value }))}
            style={{ ...input, width: 90 }} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: '#6a4040' }}>Expires (optional)</span>
          <input type="date" value={form.expiresAt}
            onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
            style={{ ...input, width: 150 }} />
        </label>
        <label className="flex flex-col gap-1 flex-1" style={{ minWidth: 180 }}>
          <span className="text-xs" style={{ color: '#6a4040' }}>Note (who it&rsquo;s for)</span>
          <input value={form.note} placeholder="Coach Tyler, Hoover HS"
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            style={{ ...input, width: '100%' }} />
        </label>
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: RED }}>
          {busy ? 'Working…' : 'Create code'}
        </button>
      </form>

      {err && (
        <p className="text-xs p-2 rounded-lg" style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>⚠ {err}</p>
      )}

      {codes === null ? <Empty>Loading codes…</Empty>
        : codes.length === 0 ? <Empty>No discount codes yet.</Empty>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Code', 'Discount', 'Used', 'Status', 'Expires', 'Note', ''].map(h => (
                    <th key={h} className="text-left px-2 py-2"
                      style={{ color: '#6a4040', borderBottom: '1px solid #2a0000',
                               fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {codes.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #1a0000' }}>
                    <td className="px-2 py-2 font-bold text-white whitespace-nowrap">{c.code}</td>
                    <td className="px-2 py-2 whitespace-nowrap" style={{ color: '#9a8080' }}>
                      {c.percentOff != null ? `${c.percentOff}% off` : usd(c.amountOffCents) + ' off'}
                    </td>
                    <td className="px-2 py-2 text-white whitespace-nowrap">
                      {c.timesRedeemed}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}
                    </td>
                    <td className="px-2 py-2">
                      <Pill tone={c.active ? 'good' : 'muted'}>
                        {c.active ? 'Active'
                          : c.expired ? 'Expired'
                          : c.exhausted ? 'Used up' : 'Inactive'}
                      </Pill>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap" style={{ color: '#9a8080' }}>{shortDate(c.expiresAt)}</td>
                    <td className="px-2 py-2" style={{ color: '#6a4040' }}>{c.note ?? '—'}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => copyLink(c.code)}
                          className="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
                          style={{ border: '1px solid #2a0000', backgroundColor: 'transparent', color: '#9a8080' }}>
                          {copied === c.code ? '✓ Copied' : 'Copy link'}
                        </button>
                        {c.rawActive && (
                          <button disabled={busy}
                            onClick={() => post({ action: 'deactivate', id: c.id })}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap disabled:opacity-50"
                            style={{ border: '1px solid #6a0000', backgroundColor: 'transparent', color: '#ff6666' }}>
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Admin() {
  // 'checking' until the endpoint has answered. Rendering either the dashboard
  // or the 404 before then would flash the wrong one.
  const [state, setState] = useState('checking')
  const [data,  setData]  = useState(null)
  const [token, setToken] = useState(null)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const jwt = session?.access_token ?? null
    if (!jwt) { setState('denied'); return }
    setToken(jwt)

    try {
      const res = await fetch('/api/admin-stats', { headers: { Authorization: `Bearer ${jwt}` } })
      if (res.status === 404) { setState('denied'); return }
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setState('error'); setData({ error: body.error ?? 'Could not load.' }); return }
      setData(body); setState('ready')
    } catch {
      setState('error'); setData({ error: 'Could not reach the server.' })
    }
  }, [])

  // Kicked off a tick after commit, with the timer cleared on unmount. Two
  // reasons: a dashboard that mounts and immediately unmounts (a mistyped URL,
  // a fast back-button) never starts the request at all, and the fetch stays
  // out of the commit phase instead of cascading a render.
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#080000' }}>
        <div className="w-8 h-8 rounded-full border-2 animate-spin"
             style={{ borderColor: RED, borderTopColor: 'transparent' }} />
      </div>
    )
  }

  // Identical to a mistyped URL. See the header comment.
  if (state === 'denied') return <NotFoundPage />

  if (state === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6"
           style={{ backgroundColor: '#080000' }}>
        <Logo variant="white" height={36} />
        <p className="text-sm" style={{ color: '#ff6666' }}>{data?.error}</p>
        <button onClick={load} className="px-4 py-2 rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: RED }}>Retry</button>
      </div>
    )
  }

  const { summary: s, attention: a, weeks, accounts, stripeError, cachedAt } = data

  return (
    <div className="min-h-screen px-4 md:px-8 py-6 flex flex-col gap-5" style={{ backgroundColor: '#080000' }}>

      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Logo variant="white" height={30} />
          <span className="text-xs uppercase tracking-widest px-2 py-1 rounded"
                style={{ backgroundColor: '#1a0000', color: '#6a4040', border: '1px solid #2a0000' }}>
            Admin
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: '#4a2020' }}>
            Data as of {cachedAt ? new Date(cachedAt).toLocaleTimeString() : '—'} · cached 60s
          </span>
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ border: '1px solid #2a0000', color: '#9a8080' }}>Refresh</button>
        </div>
      </header>

      {stripeError && (
        <p className="text-xs p-3 rounded-lg" style={{ backgroundColor: '#2a0000', color: '#ff6666', border: '1px solid #4a0000' }}>
          ⚠ Stripe data unavailable — renewal dates, amounts and ARR are incomplete. ({stripeError})
        </p>
      )}

      {/* ── Summary ── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Card label="Paying accounts" value={s.payingTotal}
              hint={`${s.payingByTier.individual} individual · ${s.payingByTier.school} school`} />
        <Card label="ARR" value={usd(s.arrCents)} tone="good"
              hint="Billed this period, after discounts. Codes are one-time, so steady state is higher." />
        <Card label="Active trials" value={s.activeTrials} tone="warn" />
        <Card label="Conversion (all time)" value={pct(s.conversionAllTime)}
              hint={`${s.payingTotal} paid of ${s.cohortAllTime} signups`} />
        <Card label="Conversion (30d)" value={pct(s.conversionLast30)}
              hint={`cohort of ${s.cohortLast30} signups`} />
        <Card label="Past due" value={s.pastDue} tone={s.pastDue > 0 ? 'bad' : 'default'} />
        <Card label="Canceled (30d)" value={s.canceledLast30} tone={s.canceledLast30 > 0 ? 'bad' : 'default'} />
        <Card label="Complimentary" value={s.complimentary} />
      </div>

      {/* ── Needs attention ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel title="Trials ending in 7 days" subtitle={`${a.trialsEnding.length} account(s)`}>
          {a.trialsEnding.length === 0 ? <Empty>Nothing ending this week.</Empty> : (
            <ul className="flex flex-col gap-2">
              {a.trialsEnding.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-white block truncate">{t.name}</span>
                    <a href={`mailto:${t.email}`} className="text-xs underline truncate block"
                       style={{ color: '#9a8080' }}>{t.email ?? 'no owner email'}</a>
                  </span>
                  <Pill tone={t.daysLeft <= 2 ? 'bad' : 'warn'}>
                    {t.daysLeft <= 0 ? 'today' : `${t.daysLeft}d`}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Past due" subtitle={`${a.pastDue.length} account(s)`}>
          {a.pastDue.length === 0 ? <Empty>No failed payments.</Empty> : (
            <ul className="flex flex-col gap-2">
              {a.pastDue.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-white block truncate">{t.name}</span>
                    <a href={`mailto:${t.email}`} className="text-xs underline truncate block"
                       style={{ color: '#9a8080' }}>{t.email ?? 'no owner email'}</a>
                  </span>
                  <Pill tone="bad">{usd(t.amountCents)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Renewals in 30 days" subtitle={`${a.renewals.length} account(s)`}>
          {a.renewals.length === 0 ? <Empty>No renewals due.</Empty> : (
            <ul className="flex flex-col gap-2">
              {a.renewals.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="text-white block truncate">{t.name}</span>
                    <span className="text-xs block" style={{ color: '#9a8080' }}>
                      {shortDate(t.renewalAt)}
                      {t.cancelAtPeriodEnd && ' · cancels'}
                    </span>
                  </span>
                  <Pill tone={t.cancelAtPeriodEnd ? 'bad' : 'good'}>{usd(t.amountCents)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Last 12 weeks" subtitle="New sign-ups vs new paid accounts">
        <WeeklyChart weeks={weeks} />
      </Panel>

      <AccountTable rows={accounts} />

      {token && <CodeManager token={token} />}
    </div>
  )
}
