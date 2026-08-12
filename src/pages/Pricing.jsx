import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'

// ── Plan definitions ──────────────────────────────────────────────────────────
const PLANS = [
  {
    id:          'single',
    name:        'Single Program',
    desc:        'Perfect for one team or program',
    monthlyPrice: 79,
    annualPrice:  749,
    annualNote:   'Save ~21%',
    priceIdMonthly: import.meta.env.VITE_STRIPE_PRICE_SINGLE_MONTHLY,
    priceIdAnnual:  import.meta.env.VITE_STRIPE_PRICE_SINGLE_ANNUAL,
    features: [
      'Unlimited practice scripts',
      'Live timer with air horn',
      'MP3 music player',
      'Scoreboard display',
      'Video library',
      'Up to 5 coaches',
      'iPad & desktop ready',
    ],
    highlight: false,
  },
  {
    id:          'school',
    name:        'School',
    desc:        'Multiple programs, one account',
    monthlyPrice: 199,
    annualPrice:  1872,
    annualNote:   'Save ~22%',
    priceIdMonthly: import.meta.env.VITE_STRIPE_PRICE_SCHOOL_MONTHLY,
    priceIdAnnual:  import.meta.env.VITE_STRIPE_PRICE_SCHOOL_ANNUAL,
    features: [
      'Everything in Single Program',
      'Unlimited programs / teams',
      'Unlimited coaches',
      'Admin dashboard',
      'Priority support',
      'Early access to new features',
    ],
    highlight: true,
  },
]

// ── Helper ────────────────────────────────────────────────────────────────────
function fmt(n) {
  return n.toLocaleString('en-US')
}

// ── Pricing page ─────────────────────────────────────────────────────────────
export default function Pricing() {
  const { user, profile } = useAuth()
  const navigate          = useNavigate()
  const [annual,  setAnnual]  = useState(true)
  const [loading, setLoading] = useState(null)  // priceId being checked out
  const [error,   setError]   = useState('')

  const orgId   = profile?.current_org_id ?? null
  const email   = user?.email     ?? ''
  const orgName = ''   // caller can pass this; we leave blank if unknown

  async function startTrial(plan) {
    const priceId = annual ? plan.priceIdAnnual : plan.priceIdMonthly

    // Not logged in — send to login first
    if (!user) { navigate('/'); return }

    if (!orgId) {
      setError('Finish setting up your program in Settings before subscribing.')
      return
    }

    setError('')
    setLoading(priceId)
    try {
      const res = await fetch('/api/stripe-checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ priceId, accountId: orgId, email, orgName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Checkout failed')
      window.location.href = data.url
    } catch (err) {
      setError(err.message ?? 'Could not start checkout. Try again.')
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#080000' }}>

      {/* ── Top nav ── */}
      <nav className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid #1a0000' }}>
        <button onClick={() => navigate(user ? '/dashboard' : '/')} className="flex items-center">
          <Logo variant="default" height={36} />
        </button>
        <button
          onClick={() => navigate(user ? '/dashboard' : '/')}
          className="text-xs font-semibold px-4 py-2 rounded-lg"
          style={{ border: '1px solid #2a0000', color: '#9a8080' }}
        >
          {user ? '← Dashboard' : 'Sign in'}
        </button>
      </nav>

      {/* ── Hero ── */}
      <div className="text-center px-6 pt-12 pb-8">
        <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
          Simple, honest pricing.
        </h1>
        <p className="text-base" style={{ color: '#9a8080' }}>
          Start with a free 14-day trial. No credit card required to try.
        </p>

        {/* ── Annual / Monthly toggle ── */}
        <div className="flex items-center justify-center gap-3 mt-6">
          <span className="text-sm font-semibold"
            style={{ color: !annual ? '#fff' : '#4a2020' }}>Monthly</span>
          <button
            onClick={() => setAnnual(a => !a)}
            className="relative w-12 h-6 rounded-full transition-colors"
            style={{ backgroundColor: annual ? '#cc1111' : '#2a0000' }}
          >
            <span
              className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
              style={{ left: annual ? '1.625rem' : '0.25rem' }}
            />
          </button>
          <span className="text-sm font-semibold"
            style={{ color: annual ? '#fff' : '#4a2020' }}>
            Annual
            <span className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: '#cc111122', color: '#ff6666', border: '1px solid #cc111144' }}>
              Save 20%
            </span>
          </span>
        </div>
      </div>

      {/* ── Plan cards ── */}
      <div className="flex-1 flex items-start justify-center gap-5 px-6 pb-12 flex-wrap">
        {PLANS.map(plan => {
          const price     = annual ? plan.annualPrice   : plan.monthlyPrice
          const priceId   = annual ? plan.priceIdAnnual : plan.priceIdMonthly
          const isLoading = loading === priceId

          return (
            <div
              key={plan.id}
              className="w-full max-w-sm flex flex-col rounded-2xl overflow-hidden"
              style={{
                backgroundColor: plan.highlight ? '#110000' : '#0d0000',
                border:          `2px solid ${plan.highlight ? '#cc1111' : '#2a0000'}`,
                boxShadow:        plan.highlight ? '0 0 40px #cc111133' : 'none',
              }}
            >
              {plan.highlight && (
                <div className="text-center py-1.5 text-xs font-black tracking-widest uppercase"
                  style={{ backgroundColor: '#cc1111', color: '#fff' }}>
                  Most Popular
                </div>
              )}

              <div className="p-6 flex flex-col gap-5 flex-1">
                {/* Plan name */}
                <div>
                  <h2 className="text-xl font-black text-white">{plan.name}</h2>
                  <p className="text-sm mt-1" style={{ color: '#9a8080' }}>{plan.desc}</p>
                </div>

                {/* Price */}
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-black text-white">${fmt(price)}</span>
                  <span className="text-sm mb-1.5" style={{ color: '#9a8080' }}>
                    /{annual ? 'yr' : 'mo'}
                  </span>
                  {annual && (
                    <span className="ml-2 mb-1.5 text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#1a2200', color: '#88cc44', border: '1px solid #2a3300' }}>
                      {plan.annualNote}
                    </span>
                  )}
                </div>

                {/* Trial note */}
                <p className="text-xs font-semibold" style={{ color: '#cc8800' }}>
                  ✦ 14-day free trial — cancel any time
                </p>

                {/* Features */}
                <ul className="flex flex-col gap-2 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-white">
                      <span className="mt-0.5 shrink-0 text-xs" style={{ color: '#cc1111' }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA button */}
                <button
                  onClick={() => startTrial(plan)}
                  disabled={!!loading}
                  className="w-full py-3.5 rounded-xl text-sm font-black text-white disabled:opacity-60 transition-all active:scale-95"
                  style={{
                    backgroundColor: plan.highlight ? '#cc1111' : 'transparent',
                    border:          plan.highlight ? 'none' : '2px solid #cc1111',
                    color:           '#fff',
                    boxShadow:       plan.highlight ? '0 4px 20px #cc111166' : 'none',
                  }}
                >
                  {isLoading ? 'Starting…' : 'Start Free 14-Day Trial'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="text-center text-sm px-6 pb-6" style={{ color: '#ff6666' }}>{error}</p>
      )}

      {/* ── Footer ── */}
      <div className="text-center px-6 py-6" style={{ borderTop: '1px solid #1a0000' }}>
        <p className="text-xs" style={{ color: '#4a2020' }}>
          Secure payments via Stripe. Cancel any time. No refunds for partial periods.
        </p>
      </div>
    </div>
  )
}
