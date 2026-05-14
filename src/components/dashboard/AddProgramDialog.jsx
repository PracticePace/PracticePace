// ─────────────────────────────────────────────────────────────────────────────
// AddProgramDialog — modal for the "Add Program" flow in Settings.
//
// Two-step flow:
//
//   STEP 1 — AD designation (shown only when this is the 1→2 transition).
//     Caller is currently 'head_coach' on a single-program account. We
//     must designate an Athletic Director before creating the second
//     program (server-side requirement, see api/add-program.js). Two
//     radio options:
//       • "Make me the Athletic Director" (default) — promotes caller.
//       • "Invite someone else as Athletic Director" — inline email +
//         name fields; the new AD gets an invite email.
//
//   STEP 2 — New program details.
//     Program name + sport picker. Submit calls /api/add-program with
//     the chosen AD designation (or none if caller is already AD).
//
// If the caller is already 'ad' (i.e. account already has 2+ programs)
// we skip step 1 entirely and open straight on step 2.
//
// PROPS
//   open                  : boolean
//   onClose               : () => void
//   onCreated(orgId, opts): () => void  — fires after a successful create.
//                                          Parent should refresh allOrgs +
//                                          optionally switch context to
//                                          the new program.
//   callerRole            : 'ad' | 'head_coach'  (other roles never see
//                                                 the button that opens
//                                                 this dialog)
//   currentProgramCount   : number  — drives whether step 1 is shown.
//   orgColor              : string  — for the primary button styling.
//   sports                : Array<{ value: string; label: string }>
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const inputStyle = {
  backgroundColor: '#1a0000',
  border:          '1px solid #2a0000',
  color:           '#fff',
}

export default function AddProgramDialog({
  open, onClose, onCreated, callerRole, currentProgramCount, orgColor, sports,
}) {
  // Needs-designation = the 1→2 upgrade case: head_coach + currently 1 program.
  const needsDesignation = callerRole === 'head_coach' && currentProgramCount === 1
  const initialStep = needsDesignation ? 1 : 2
  const [step, setStep] = useState(initialStep)

  // Step 1 state
  const [designation, setDesignation] = useState('self') // 'self' | 'invite'
  const [adEmail, setAdEmail]         = useState('')
  const [adName, setAdName]           = useState('')

  // Step 2 state
  const [programName, setProgramName] = useState('')
  const defaultSport = sports?.[0]?.value ?? 'football'
  const [sport, setSport]             = useState(defaultSport)

  const [submitting, setSubmitting]   = useState(false)
  const [err, setErr]                 = useState('')
  const [warning, setWarning]         = useState('')

  // Reset state every time the dialog opens. Otherwise a previous abandoned
  // attempt's email / name / errors leak into the next session.
  useEffect(() => {
    if (!open) return
    setStep(initialStep)
    setDesignation('self')
    setAdEmail('')
    setAdName('')
    setProgramName('')
    setSport(defaultSport)
    setSubmitting(false)
    setErr('')
    setWarning('')
  }, [open, initialStep, defaultSport])

  if (!open) return null

  function emailLooksValid(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim())
  }

  function goToStep2() {
    setErr('')
    if (designation === 'invite' && !emailLooksValid(adEmail)) {
      setErr('Enter a valid email for the Athletic Director.')
      return
    }
    setStep(2)
  }

  async function submit() {
    setErr('')
    setWarning('')

    const name = programName.trim()
    if (!name)  { setErr('Program name is required.'); return }
    if (!sport) { setErr('Pick a sport for this program.'); return }

    let adDesignation = null
    if (needsDesignation) {
      adDesignation = designation === 'self'
        ? 'self'
        : { email: adEmail.trim().toLowerCase(), name: adName.trim() }
    }

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setErr('Your session expired — please reload and try again.')
        setSubmitting(false)
        return
      }

      const res = await fetch('/api/add-program', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name, sport, adDesignation }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.error ?? `Could not create program (${res.status}).`)
        setSubmitting(false)
        return
      }

      // Surface non-fatal warnings (e.g. org created but AD invite
      // failed). Parent still treats the program as created.
      if (data?.warning) setWarning(data.warning)
      onCreated?.(data.orgId, {
        promotedToAd:   data?.promotedToAd   === true,
        invitedAdEmail: data?.invitedAdEmail ?? null,
        warning:        data?.warning        ?? null,
      })

      // If there's a warning the parent might want to show, leave the
      // dialog open so the user sees it. Otherwise close immediately.
      if (!data?.warning) onClose?.()
    } catch (e) {
      console.error('[AddProgramDialog] submit error:', e?.message ?? e)
      setErr('Could not create program — try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}
      onClick={() => { if (!submitting) onClose?.() }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4"
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── STEP 1: AD designation ───────────────────────────────────────── */}
        {step === 1 && (
          <>
            <h3 className="font-bold text-white text-lg">Designate an Athletic Director</h3>

            <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
              Your account is moving to a multi-program school setup. An
              Athletic Director manages school-wide settings, billing, and
              access across all programs.
            </p>
            <p className="text-xs leading-relaxed rounded-lg px-3 py-2"
               style={{ color: '#9a8080', backgroundColor: '#1a0d00', border: '1px solid #2a1500' }}>
              Note: The "Athletic Director" role here is about software
              administration — not your school's organizational chart. If
              your school doesn't have a formal AD, or your AD doesn't need
              software access, designate whoever handles administrative
              responsibilities for Practice:Pace (often the head coach of
              the founding program, a business manager, or a dedicated
              booster club member).
            </p>

            <div className="flex flex-col gap-3">
              {/* Option A: self */}
              <label
                className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                style={{
                  border: `1px solid ${designation === 'self' ? orgColor : '#2a0000'}`,
                  backgroundColor: designation === 'self' ? `${orgColor}11` : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="designation"
                  value="self"
                  checked={designation === 'self'}
                  onChange={() => setDesignation('self')}
                  className="mt-0.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white">Make me the Athletic Director</div>
                  <div className="text-xs" style={{ color: '#9a8080' }}>
                    Promotes your role from Head Coach to Athletic Director.
                    You'll keep access to your current program and gain
                    school-wide access to the new one.
                  </div>
                </div>
              </label>

              {/* Option B: invite someone else */}
              <label
                className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                style={{
                  border: `1px solid ${designation === 'invite' ? orgColor : '#2a0000'}`,
                  backgroundColor: designation === 'invite' ? `${orgColor}11` : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="designation"
                  value="invite"
                  checked={designation === 'invite'}
                  onChange={() => setDesignation('invite')}
                  className="mt-0.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white">Invite someone else as Athletic Director</div>
                  <div className="text-xs" style={{ color: '#9a8080' }}>
                    Send an email invite — they sign up and become AD on
                    arrival. You stay as Head Coach of your current program.
                  </div>
                </div>
              </label>

              {designation === 'invite' && (
                <div className="flex flex-col gap-2 pl-2">
                  <input
                    type="text"
                    value={adName}
                    onChange={e => setAdName(e.target.value)}
                    placeholder="AD full name (optional)"
                    className="rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={inputStyle}
                  />
                  <input
                    type="email"
                    required
                    value={adEmail}
                    onChange={e => setAdEmail(e.target.value)}
                    placeholder="ad@school.edu"
                    className="rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={inputStyle}
                  />
                </div>
              )}
            </div>

            {err && (
              <p className="text-xs rounded-lg px-3 py-2"
                 style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                {err}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-lg text-sm font-semibold"
                style={{ border: '1px solid #2a0000', color: '#9a8080' }}
              >
                Cancel
              </button>
              <button
                onClick={goToStep2}
                className="flex-1 py-3 rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: orgColor }}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: new program details ─────────────────────────────────── */}
        {step === 2 && (
          <>
            <h3 className="font-bold text-white text-lg">
              {needsDesignation ? 'New Program Details' : 'Add a Program'}
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: '#9a8080' }}>
              {needsDesignation
                ? 'Set up the second program. You can fine-tune colors, the logo, and invite coaches after the program is created.'
                : 'Add another program to your school. You can fine-tune colors, the logo, and invite coaches after the program is created.'}
            </p>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-widest"
                       style={{ color: '#9a8080' }}>
                  Program Name
                </label>
                <input
                  type="text"
                  value={programName}
                  onChange={e => setProgramName(e.target.value)}
                  placeholder="e.g. Girls Basketball, Varsity Volleyball"
                  className="rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-widest"
                       style={{ color: '#9a8080' }}>
                  Sport
                </label>
                <select
                  value={sport}
                  onChange={e => setSport(e.target.value)}
                  className="rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                >
                  {sports.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {err && (
              <p className="text-xs rounded-lg px-3 py-2"
                 style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
                {err}
              </p>
            )}
            {warning && (
              <p className="text-xs rounded-lg px-3 py-2 leading-relaxed"
                 style={{ backgroundColor: '#1a1000', color: '#f59e0b', border: '1px solid #3a2800' }}>
                ⚠ {warning}
              </p>
            )}

            <div className="flex gap-3">
              {needsDesignation ? (
                <button
                  onClick={() => setStep(1)}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ border: '1px solid #2a0000', color: '#9a8080' }}
                >
                  ← Back
                </button>
              ) : (
                <button
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ border: '1px solid #2a0000', color: '#9a8080' }}
                >
                  Cancel
                </button>
              )}
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: orgColor }}
              >
                {submitting ? 'Creating…' : 'Create Program'}
              </button>
            </div>

            {warning && (
              <button
                onClick={onClose}
                className="text-xs underline opacity-60 hover:opacity-90 self-center"
                style={{ color: '#9a8080' }}
              >
                Close
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
