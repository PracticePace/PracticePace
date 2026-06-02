// ─────────────────────────────────────────────────────────────────────────────
// DuplicateScriptDialog — small rename prompt that opens between a coach
// tapping "Duplicate" on a script and the actual INSERT. Default value
// is "<source name> (copy)"; coach types over it or accepts as-is.
//
// Layered modal pattern mirrors WhiteboardImageNameDialog: fixed inset-0
// z-50, header + input + pinned footer, auto-focus + select-all so the
// coach can immediately retype OR hit Enter to confirm the default.
//
// PROPS
//   defaultName     — initial value of the input.
//   working         — true while the parent is INSERTing; disables both
//                     buttons + input + the Enter-to-submit path.
//   error           — parent-reported error string; surfaced inline.
//   orgColor        — accent color for the primary button.
//   onCancel()      — close without duplicating.
//   onConfirm(name) — fires when the coach taps Duplicate / hits Enter
//                     on a non-empty name. Name is trimmed.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'

const MAX_NAME_LENGTH = 120

export default function DuplicateScriptDialog({
  defaultName = '',
  working     = false,
  error       = '',
  orgColor    = '#cc1111',
  onCancel,
  onConfirm,
}) {
  const [name, setName] = useState(defaultName)
  const inputRef        = useRef(null)

  // Auto-focus + select-all so the coach can type a new name immediately
  // OR hit Enter to confirm the default. Tiny delay lets the dialog
  // animate in before stealing focus on iOS.
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 50)
    return () => clearTimeout(t)
  }, [])

  const trimmed   = name.trim()
  const canSubmit = trimmed.length > 0 && !working

  function handleSubmit(e) {
    e?.preventDefault?.()
    if (!canSubmit) return
    onConfirm?.(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl flex flex-col p-5"
        style={{
          backgroundColor: '#110000',
          border:          '1px solid #2a0000',
          maxHeight:       '92vh',
        }}
      >
        <div className="flex flex-col gap-1 mb-4">
          <h3 className="font-bold text-white text-lg">Duplicate Script</h3>
          <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
            Creates a copy with all drills, cues, images, notes, and
            settings. You&apos;ll be taken straight to the new copy so
            you can edit the differences.
          </p>
        </div>

        <label
          htmlFor="pp-dup-script-name"
          className="text-xs font-semibold uppercase tracking-widest mb-1.5"
          style={{ color: '#9a8080' }}
        >
          New script name
        </label>
        <input
          id="pp-dup-script-name"
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Competition Week — Polish & Run-Throughs (copy)"
          disabled={working}
          className="rounded-lg px-3 py-2.5 text-sm outline-none transition-colors disabled:opacity-60"
          style={{
            backgroundColor: '#0d0000',
            color:           'rgba(255,255,255,0.95)',
            border:          '1px solid #3a1414',
          }}
        />
        <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#7a6060' }}>
          <span>{trimmed.length === 0 ? 'Name is required' : ' '}</span>
          <span>{name.length}/{MAX_NAME_LENGTH}</span>
        </div>

        {error && (
          <p
            className="text-xs rounded-lg px-3 py-2 mt-3"
            style={{ backgroundColor: '#2a0000', color: '#ff6666' }}
          >
            {error}
          </p>
        )}

        <div
          className="flex gap-3 mt-4 pt-4"
          style={{ borderTop: '1px solid #2a0000' }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: orgColor }}
          >
            {working ? 'Duplicating…' : 'Duplicate'}
          </button>
        </div>
      </form>
    </div>
  )
}
