// ── PlanSelectModal.jsx ───────────────────────────────────────────────────────
// Shown before redirecting to Stripe checkout. Lets the coach pick a plan,
// then calls onConfirm(planKey) to kick off the redirect.
//
// Plan names, prices and feature lists come from src/lib/plans.js — the same
// config the public /pricing page renders from. This file used to hold its own
// copy as hardcoded display strings ('$79', '$749', '$199', '$1,872'), which
// meant the modal could quote one number while Stripe charged another.
//
// It also used to resolve a Stripe price id from import.meta.env and hand that
// to onConfirm. It now passes the PLAN KEY; /api/stripe-checkout maps the key
// to a price from its own environment. A price id that reaches the browser is
// a price id the caller can swap.

import { useState } from 'react'
import { PLAN_LIST, PLANS, TRIAL_DAYS } from '../../lib/plans'

export default function PlanSelectModal({ onConfirm, onClose, loading, error, currentTier }) {
  // Default to School-Wide when the account is already on Individual — the
  // only reason an Individual subscriber opens this modal is to upgrade.
  const [selected, setSelected] = useState(currentTier === 'individual' ? 'school' : 'individual')

  const plan        = PLANS[selected]
  const isUpgrading = currentTier === 'individual'

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg flex flex-col gap-5 rounded-2xl p-6 overflow-y-auto"
        style={{ backgroundColor: '#0d0000', border: '1px solid #2a0000', maxHeight: '90vh' }}
      >

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-white">
              {isUpgrading ? 'Upgrade your plan' : 'Choose your plan'}
            </h2>
            <p className="text-sm mt-0.5" style={{ color: '#9a8080' }}>
              Billed annually. Cancel anytime. No hidden fees.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none transition-opacity hover:opacity-60 shrink-0"
            style={{ color: '#4a2020' }}
          >
            ✕
          </button>
        </div>

        {/* Plan cards */}
        <div className="flex flex-col sm:flex-row gap-3">
          {PLAN_LIST.map(p => {
            const isActive  = selected === p.key
            const isCurrent = currentTier === p.key
            return (
              <button
                key={p.key}
                onClick={() => setSelected(p.key)}
                disabled={isCurrent}
                className="flex-1 rounded-xl p-4 text-left flex flex-col gap-3 transition-all disabled:opacity-50"
                style={{
                  backgroundColor: isActive ? '#1a0000' : '#110000',
                  border:    `2px solid ${isActive ? '#cc1111' : '#2a0000'}`,
                  boxShadow: isActive ? '0 0 24px rgba(204,17,17,0.3)' : 'none',
                }}
              >
                {/* Plan name + badge */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-white text-sm">{p.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#6a4040' }}>{p.summary}</p>
                  </div>
                  {isCurrent && (
                    <span
                      className="text-xs font-black px-2 py-0.5 rounded-full shrink-0"
                      style={{ backgroundColor: '#2a0000', color: '#9a8080' }}
                    >
                      Current
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-black" style={{ color: isActive ? '#cc1111' : '#9a4040' }}>
                    {p.priceText}
                  </span>
                  <span className="text-xs" style={{ color: '#6a4040' }}>{p.period}</span>
                </div>

                {/* Who pays */}
                <p className="text-xs leading-snug" style={{ color: '#4a2020' }}>{p.billedBy}</p>

                {/* Selected indicator */}
                <div
                  className="w-full rounded-lg py-1.5 text-center text-xs font-bold transition-all"
                  style={{
                    backgroundColor: isActive ? '#cc1111' : 'transparent',
                    border:          `1px solid ${isActive ? '#cc1111' : '#2a0000'}`,
                    color:           isActive ? '#fff' : '#4a2020',
                  }}
                >
                  {isCurrent ? 'Your plan' : isActive ? '✓ Selected' : 'Select'}
                </div>
              </button>
            )
          })}
        </div>

        {/* Features for the selected plan — the modal used to show none, which
            made "why is School-Wide worth $500 more" unanswerable here. */}
        <ul className="flex flex-col gap-1.5">
          {plan.features.map(f => (
            <li key={f} className="flex items-start gap-2 text-xs text-white">
              <span className="mt-0.5 shrink-0" style={{ color: '#cc1111' }}>✓</span>
              {f}
            </li>
          ))}
        </ul>

        {/* Error */}
        {error && (
          <p
            className="text-xs p-3 rounded-lg leading-relaxed"
            style={{ backgroundColor: '#2a0000', color: '#ff6666', border: '1px solid #4a0000' }}
          >
            ⚠ {error}
          </p>
        )}

        {/* CTA */}
        <button
          onClick={() => onConfirm(selected)}
          disabled={loading || currentTier === selected}
          className="w-full py-3.5 rounded-xl font-black text-white text-base disabled:opacity-50 transition-all active:scale-[0.98]"
          style={{ backgroundColor: '#cc1111', boxShadow: '0 4px 24px rgba(204,17,17,0.4)' }}
        >
          {loading
            ? 'Redirecting to Stripe…'
            : `${isUpgrading ? 'Upgrade to' : 'Subscribe —'} ${plan.name} ${plan.priceText}${plan.period}`}
        </button>

        <p className="text-xs text-center leading-relaxed" style={{ color: '#3a1818' }}>
          Secure checkout via Stripe · {TRIAL_DAYS}-day trial on new subscriptions
          <br />
          By subscribing you agree to the{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer"
             className="underline" style={{ color: '#6a4040' }}>Terms</a>.
        </p>
      </div>
    </div>
  )
}
