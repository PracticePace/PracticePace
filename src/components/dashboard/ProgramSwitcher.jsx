// ─────────────────────────────────────────────────────────────────────────────
// ProgramSwitcher — pill-style dropdown in the global header for AD users
// on a multi-program account. Lets the AD pick which program's data they're
// operating in (scripts, music, scoreboard, whiteboard, settings all
// re-scope to the selected org).
//
// VISIBILITY
//   The parent (Dashboard) is responsible for the visibility rule —
//   render only when profile.role === 'ad' AND orgs.length >= 2. This
//   component just renders the picker; it doesn't gate itself, so we
//   never have a "hidden but mounted" cost in the head_coach case.
//
// PERSISTENCE
//   The selected org is persisted in localStorage by the parent (key:
//   pp_active_org_<userId>). This component is presentational —
//   `onSelect` fires with the chosen orgId; the parent does the
//   localStorage write + state update + reload.
//
// COMPACT / EXPANDED
//   We render a compact button (program name + chevron). Tapping toggles
//   an expanded menu that lists every program with a name + sport line.
//   The currently-active program is highlighted. Tapping a program (or
//   anywhere outside the menu) closes it.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { sportLabel } from '../../lib/sports'

export default function ProgramSwitcher({ orgs, activeOrgId, onSelect, orgColor = '#cc1111' }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  // Close on click-outside.
  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('touchstart', onDocClick)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick)
    }
  }, [open])

  const active = orgs.find(o => o.id === activeOrgId) ?? orgs[0] ?? null

  function pick(orgId) {
    setOpen(false)
    if (orgId !== activeOrgId) onSelect(orgId)
  }

  if (!orgs || orgs.length === 0) return null

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
        style={{
          backgroundColor: 'rgba(0,0,0,0.32)',
          border:          `1px solid ${orgColor}66`,
          color:           '#fff',
          maxWidth:        260,
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Active program: ${active?.name ?? '—'}`}
      >
        <span
          aria-hidden="true"
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: orgColor }}
        />
        <span className="truncate" style={{ maxWidth: 180 }}>
          {active?.name ?? 'Choose a program'}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.4"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1.5 rounded-xl overflow-hidden shadow-2xl"
          style={{
            left:            0,
            top:             '100%',
            minWidth:        260,
            maxWidth:        320,
            backgroundColor: '#0d0000',
            border:          `1px solid ${orgColor}44`,
          }}
        >
          {orgs.map(o => {
            const selected = o.id === active?.id
            return (
              <button
                key={o.id}
                role="option"
                aria-selected={selected}
                onClick={() => pick(o.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                style={{
                  backgroundColor: selected ? `${orgColor}22` : 'transparent',
                  borderBottom:    '1px solid #1a0000',
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: selected ? orgColor : '#3a0000' }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-white truncate">
                    {o.name || '(unnamed program)'}
                  </span>
                  {o.sport && (
                    <span className="block text-[11px] uppercase tracking-widest"
                          style={{ color: '#9a8080' }}>
                      {sportLabel(o.sport, o.sport_custom_label)}
                    </span>
                  )}
                </span>
                {selected && (
                  <span className="text-xs font-bold shrink-0" style={{ color: orgColor }}>
                    ●
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
