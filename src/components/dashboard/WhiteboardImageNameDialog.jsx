// ─────────────────────────────────────────────────────────────────────────────
// WhiteboardImageNameDialog — lightweight prompt for the coach's label
// on a freshly-framed image, sandwiched between the framing dialog and
// the actual Storage upload + library insert.
//
// Default value comes from the source file name with the extension
// stripped: "trips-right.jpg" → "trips-right". Coach can accept as-is
// or type a custom name. Save / Cancel.
//
// Kept intentionally minimal — one input + two buttons — per the spec
// ("don't over-build it"). No tag picker, no folders, no shared/private
// toggle. Add later if real coach usage demands.
//
// PROPS
//   defaultName        — initial value of the input; pre-filled when the
//                        dialog opens.
//   working            — true while the parent is uploading + inserting.
//                        Disables both buttons + input.
//   error              — parent-reported error string (e.g. upload
//                        failed). Shown inline below the input.
//   orgColor           — accent color for the primary button.
//   onCancel()         — close without saving (parent discards the blob).
//   onConfirm(name)    — fires when the coach taps Save. Parent runs the
//                        Storage upload + whiteboard_images insert +
//                        sets the new image active. Name is trimmed but
//                        otherwise unmodified.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'

const MAX_NAME_LENGTH = 80

export default function WhiteboardImageNameDialog({
  defaultName = '',
  working     = false,
  error       = '',
  orgColor    = '#cc1111',
  onCancel,
  onConfirm,
}) {
  const [name, setName] = useState(defaultName)
  const inputRef        = useRef(null)

  // Auto-focus the input on mount so coaches can type immediately
  // without an extra tap. Select-all on focus so accepting the default
  // is one keystroke (just hit Save) but overriding it doesn't require
  // a manual clear.
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
          <h3 className="font-bold text-white text-lg">Name this image</h3>
          <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
            Saved to your program&apos;s library so you can use it again
            later. Defaults to the file name — change it if you want
            something easier to find.
          </p>
        </div>

        <label
          htmlFor="pp-wb-img-name"
          className="text-xs font-semibold uppercase tracking-widest mb-1.5"
          style={{ color: '#9a8080' }}
        >
          Name
        </label>
        <input
          id="pp-wb-img-name"
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Trips Right vs Cover 2"
          disabled={working}
          className="rounded-lg px-3 py-2.5 text-sm outline-none transition-colors disabled:opacity-60"
          style={{
            backgroundColor: '#0d0000',
            color:           'rgba(255,255,255,0.95)',
            border:          '1px solid #3a1414',
          }}
        />
        <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#7a6060' }}>
          <span>{trimmed.length === 0 ? 'Name is required' : ' '}</span>
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
            {working ? 'Saving…' : 'Save to library'}
          </button>
        </div>
      </form>
    </div>
  )
}
