// ─────────────────────────────────────────────────────────────────────────────
// AutocompleteInput — text input with a "you've used this before" dropdown.
//
// Designed to drop in as a replacement for a plain <input>. Suggestions are
// filtered IN MEMORY from a small caller-supplied list (no debouncing
// needed — datasets are bounded by the source query, typically a few
// hundred items max). Optional; the input behaves like a normal text
// field when suggestions is empty or the typed string doesn't match
// anything.
//
// USED FOR (v1): drill-name field in the script editor — both the
// AddDrillForm and the inline-edit form on DrillRow. Future fields
// (script name, drill notes) can adopt this same pattern by passing a
// different source list.
//
// PROPS
//   value          — controlled string.
//   onChange(v)    — fires on every input change (text typed OR suggestion
//                    picked). Receives the new string verbatim.
//   suggestions    — array of { name, usage_count }. Order doesn't matter
//                    — internal filtering re-sorts by usage_count desc,
//                    then alphabetically. Pass [] to make the component
//                    behave like a plain input.
//   maxResults     — top-N to show. Defaults to 5 (per spec).
//   placeholder    — passed to <input>.
//   autoFocus      — passed to <input>; coaches in AddDrillForm rely on it.
//   inputRef       — optional ref forwarded to the <input> (used by
//                    AddDrillForm to .focus() the field after each Add).
//   onKeyDown(e)   — forwarded AFTER autocomplete's own keyboard handling.
//                    If the dropdown is open and a suggestion is
//                    highlighted, Enter is consumed for selection and
//                    will NOT call onKeyDown. Otherwise (dropdown closed
//                    or no highlight), Enter falls through so existing
//                    submit-on-enter handlers keep working.
//   className,
//   inputClassName,
//   style,
//   inputStyle     — split styling: outer wrapper vs. the <input>
//                    itself, so callers can mirror the look of their
//                    existing inputs without restyling the entire
//                    autocomplete shell.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_MAX_RESULTS = 5

// Case-insensitive substring filter + usage_count sort. Pure function so
// it memoizes cleanly inside the component.
function filterAndRank(value, suggestions, maxResults) {
  const q = value.trim().toLowerCase()
  if (q.length === 0) return []                       // no input → no dropdown
  const matches = []
  for (const s of suggestions) {
    if (!s || typeof s.name !== 'string') continue
    const idx = s.name.toLowerCase().indexOf(q)
    if (idx === -1) continue
    // Skip exact matches — if the coach has already typed the suggested
    // name verbatim there's nothing useful to offer them.
    if (s.name.toLowerCase() === q) continue
    matches.push({ ...s, matchIndex: idx, matchLength: q.length })
  }
  matches.sort((a, b) => {
    if (b.usage_count !== a.usage_count) return (b.usage_count ?? 0) - (a.usage_count ?? 0)
    return a.name.localeCompare(b.name)
  })
  return matches.slice(0, maxResults)
}

// Render the suggestion's name with the matched substring bolded —
// helps the coach see WHY each result is in the list when they have
// multiple drill names with overlapping fragments ("Standing Tumbling",
// "Standing Line Drill", "Stand & Throw", etc.).
function HighlightedName({ name, start, length }) {
  if (start < 0 || length <= 0) return <span>{name}</span>
  const before = name.slice(0, start)
  const hit    = name.slice(start, start + length)
  const after  = name.slice(start + length)
  return (
    <span>
      {before}
      <strong style={{ color: '#ffffff', fontWeight: 800 }}>{hit}</strong>
      {after}
    </span>
  )
}

export default function AutocompleteInput({
  value,
  onChange,
  suggestions   = [],
  maxResults    = DEFAULT_MAX_RESULTS,
  placeholder   = '',
  autoFocus     = false,
  inputRef,
  onKeyDown,
  className     = '',
  inputClassName = 'rounded-lg px-3 py-2.5 text-sm outline-none w-full',
  style         = {},
  inputStyle    = { backgroundColor: '#0d0000', border: '1px solid #3a0000', color: '#fff' },
}) {
  const [open,        setOpen]        = useState(false)
  const [highlight,   setHighlight]   = useState(-1)
  const internalRef                   = useRef(null)
  const wrapRef                       = useRef(null)
  const inputEl                       = inputRef ?? internalRef

  const filtered = useMemo(
    () => filterAndRank(value, suggestions, maxResults),
    [value, suggestions, maxResults],
  )

  // Reset highlight whenever the filtered list contents change so
  // pressing ArrowDown from a freshly-narrowed list starts at the top.
  useEffect(() => { setHighlight(-1) }, [filtered.length, value])

  // Close on click outside the wrapping <div>.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('touchstart', onDocMouseDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('touchstart', onDocMouseDown)
    }
  }, [open])

  function handleInputChange(e) {
    const v = e.target.value
    onChange?.(v)
    setOpen(true)
  }

  function handleFocus() {
    if (filtered.length > 0) setOpen(true)
  }

  function selectSuggestion(s) {
    onChange?.(s.name)
    setOpen(false)
    setHighlight(-1)
    // Restore focus to the input so the coach can keep typing /
    // tabbing without an extra tap.
    inputEl.current?.focus()
  }

  function handleKeyDown(e) {
    if (open && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight(h => Math.min(filtered.length - 1, h < 0 ? 0 : h + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight(h => Math.max(0, h - 1))
        return
      }
      if (e.key === 'Enter' && highlight >= 0) {
        // Only swallow Enter when a suggestion is highlighted —
        // otherwise let the parent's onKeyDown handle it (e.g.
        // AddDrillForm's submit-on-Enter).
        e.preventDefault()
        selectSuggestion(filtered[highlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        setHighlight(-1)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={style}>
      <input
        ref={inputEl}
        type="text"
        value={value ?? ''}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        className={inputClassName}
        style={inputStyle}
        aria-autocomplete="list"
        aria-expanded={open && filtered.length > 0}
        aria-controls="pp-autocomplete-list"
      />

      {open && filtered.length > 0 && (
        <ul
          id="pp-autocomplete-list"
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 rounded-lg overflow-hidden"
          style={{
            backgroundColor: '#0a0000',
            border:          '1px solid #3a1414',
            boxShadow:       '0 10px 30px rgba(0,0,0,0.55)',
            // Cap height so a wide-monitor library doesn't overflow
            // ridiculously; internal scroll if the (rare) overflow case
            // hits. The maxResults cap also bounds this.
            maxHeight:       'min(50vh, 280px)',
            overflowY:       'auto',
          }}
        >
          {filtered.map((s, i) => {
            const isHL = i === highlight
            return (
              <li
                key={`${s.name}-${i}`}
                role="option"
                aria-selected={isHL}
                // onMouseDown (not onClick) so the click fires BEFORE
                // the input's onBlur cascade, which would otherwise
                // close the dropdown and never get to the select.
                onMouseDown={e => { e.preventDefault(); selectSuggestion(s) }}
                onMouseEnter={() => setHighlight(i)}
                className="flex items-center justify-between gap-3 px-3 cursor-pointer transition-colors"
                style={{
                  minHeight:       44,            // iOS HIG touch target
                  backgroundColor: isHL ? '#1a0808' : 'transparent',
                  color:           '#c8b0b0',
                  fontSize:        '0.875rem',
                  borderBottom:    '1px solid #1a0000',
                }}
              >
                <span className="truncate">
                  <HighlightedName
                    name={s.name}
                    start={s.matchIndex}
                    length={s.matchLength}
                  />
                </span>
                {/* Subtle usage-count badge — coaches see at-a-glance
                    that "Standing Line Drill" gets used 12 times vs
                    "Standing Tumbling Pass" 3 times. */}
                {typeof s.usage_count === 'number' && s.usage_count > 1 && (
                  <span
                    className="text-[10px] font-semibold uppercase tracking-widest shrink-0"
                    style={{ color: '#7a6060' }}
                  >
                    used {s.usage_count}×
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
