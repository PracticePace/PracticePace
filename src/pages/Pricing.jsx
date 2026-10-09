// Pricing page — /pricing
//
// Plan names, prices and feature lists all come from src/lib/plans.js, which
// the in-app paywall (PlanSelectModal.jsx) reads from too. Before that shared
// config existed this file held the prices as numbers and the modal held them
// again as hardcoded strings, with nothing keeping the two in agreement or
// either of them in agreement with Stripe.
//
// The monthly/annual toggle is gone. Both plans are billed annually, so a
// toggle with one position on each side was just a control that did nothing.

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { PLAN_LIST, TRIAL_DAYS } from '../lib/plans'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'

function fmt(n) {
  return n.toLocaleString('en-US')
}

export default function Pricing() {
  const { user, profile } = useAuth()
  const navigate          = useNavigate()
  const [loading, setLoading] = useState(null)   // plan key being checked out
  const [error,   setError]   = useState('')

  const orgId = profile?.current_org_id ?? null

  async function startTrial(plan) {
    // Anonymous visitor: the Create Account tab, carrying the plan they
    // clicked. This used to navigate('/') — the marketing home page — which
    // for a signed-out visitor meant the button appeared to do nothing, and
    // for a signed-in one bounced to the dashboard. Either way the plan
    // choice was thrown away. Login parks ?plan= for Onboarding to preselect.
    if (!user) {
      navigate(`/login?mode=signup&plan=${encodeURIComponent(plan.key)}`)
      return
    }

    // Signed in but no program yet — they belong in onboarding, not checkout.
    // Previously this was a dead-end error telling them to go to Settings for
    // something Settings can't do.
    if (!orgId) {
      navigate(`/onboarding?plan=${encodeURIComponent(plan.key)}`)
      return
    }

    setError('')
    setLoading(plan.key)
    try {
      // /api/stripe-checkout requires a Supabase JWT and derives the account,
      // email and program name from the verified session. The body carries
      // only the PLAN KEY — the server maps that to a Stripe price from its own
      // environment. Sending a price id from here would let a caller name any
      // price on our Stripe account and get entitlement written from it.
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token ?? null
      if (!accessToken) {
        throw new Error('Your session has expired — please sign in again.')
      }

      const res = await fetch('/api/stripe-checkout', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body:    JSON.stringify({ plan: plan.key }),
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
    // Wrapped in the same chrome as /about and /contact. This page used to
    // carry its own cut-down nav and no footer at all, so it was the one
    // marketing page you could not navigate away from — and the only one with
    // no route to the legal pages.
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#080000' }}>
      <MarketingHeader />

      {/* ── Hero ── */}
      <div className="text-center px-6 pt-12 pb-8">
        <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
          Simple, honest pricing.
        </h1>
        <p className="text-base" style={{ color: '#9a8080' }}>
          Start with a free {TRIAL_DAYS}-day trial. No credit card required to try.
        </p>
        <p className="text-sm mt-2" style={{ color: '#6a4040' }}>
          Two plans, both billed annually.
        </p>
      </div>

      {/* ── Plan cards ── */}
      <div className="flex-1 flex items-start justify-center gap-5 px-6 pb-12 flex-wrap">
        {PLAN_LIST.map(plan => {
          const isLoading = loading === plan.key

          return (
            <div
              key={plan.key}
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
                  <p className="text-sm mt-1" style={{ color: '#9a8080' }}>{plan.tagline}</p>
                </div>

                {/* Price */}
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-black text-white">${fmt(plan.price)}</span>
                  <span className="text-sm mb-1.5" style={{ color: '#9a8080' }}>
                    {plan.period}
                  </span>
                </div>

                {/* Who pays */}
                <p className="text-xs" style={{ color: '#6a4040' }}>{plan.billedBy}</p>

                {/* Trial note */}
                <p className="text-xs font-semibold" style={{ color: '#cc8800' }}>
                  ✦ {TRIAL_DAYS}-day free trial — cancel any time
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
                  {isLoading ? 'Starting…' : `Start Free ${TRIAL_DAYS}-Day Trial`}
                </button>

                {/* Terms consent — sits with the button that creates the
                    obligation, not buried in the page footer. */}
                <p className="text-xs text-center leading-relaxed" style={{ color: '#4a2020' }}>
                  By subscribing you agree to the{' '}
                  <Link to="/terms" className="underline" style={{ color: '#9a8080' }}>Terms</Link>.
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="text-center text-sm px-6 pb-6" style={{ color: '#ff6666' }}>{error}</p>
      )}

      {/* Fine print stays with the plans; site-wide links come from the
          shared footer below. */}
      <div className="text-center px-6 py-6" style={{ borderTop: '1px solid #1a0000' }}>
        <p className="text-xs" style={{ color: '#4a2020' }}>
          Secure payments via Stripe. Annual subscriptions renew automatically
          and can be cancelled any time from the billing portal. No prorated refunds.
        </p>
      </div>

      <MarketingFooter />
    </div>
  )
}
