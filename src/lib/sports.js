// ── Sport list (shared) ──────────────────────────────────────────────────────
// Used by the org sport selector in Settings / Add Program / Scripts. The
// canonical lowercase snake_case `value` is what we persist to
// organizations.sport and scripts.sport; `label` is the display string.
// Allowed values are enforced by organizations_sport_check and
// scripts_sport_check — see migration 20260521000000.
//
// Order matters: the dropdown renders in this exact order, with "Custom"
// always last regardless of where the rest are. Don't alphabetise.
//
// 'custom' pairs with organizations.sport_custom_label. The UI shows a
// text input when sport='custom' so the coach can type a free-form
// label like "8-Man Football" or "Esports". For scripts (which don't
// have their own custom-label column) 'custom' just means "this script
// belongs to a custom-sport program" — the org's label is the authority.

export const SPORTS = [
  { value: 'football',         label: 'Football'         },
  { value: 'flag_football',    label: 'Flag Football'    },
  { value: 'boys_basketball',  label: 'Boys Basketball'  },
  { value: 'girls_basketball', label: 'Girls Basketball' },
  { value: 'cheerleading',     label: 'Cheerleading'     },
  { value: 'boys_soccer',      label: 'Boys Soccer'      },
  { value: 'girls_soccer',     label: 'Girls Soccer'     },
  { value: 'volleyball',       label: 'Volleyball'       },
  { value: 'baseball',         label: 'Baseball'         },
  { value: 'softball',         label: 'Softball'         },
  { value: 'custom',           label: 'Custom'           },
]

// Quick lookup by canonical value. Returns the Title-Case display label
// for any sport in the launch list. For legacy / grandfathered values
// not in the list (e.g. 'basketball' before the boys/girls split,
// 'stunt', 'dance team'), returns a best-effort title-cased version of
// the raw value so the UI doesn't render raw snake_case to the user.
export function sportLabel(value, customLabel = null) {
  if (value === 'custom') {
    const trimmed = (customLabel ?? '').trim()
    return trimmed ? `Custom — ${trimmed}` : 'Custom'
  }
  const found = SPORTS.find(s => s.value === value)
  if (found) return found.label
  // Legacy / grandfathered fallback: turn snake_case + spaced lowercase
  // into Title Case ("dance team" → "Dance Team", "track and field" →
  // "Track and Field" — small-word casing isn't perfect but readable).
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

