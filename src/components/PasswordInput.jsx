import { useState, forwardRef } from 'react'

// Inline SVG copies of lucide-react's Eye and EyeOff so we don't have to
// add a dependency just for two icons.
const EyeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const EyeOffIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)

/**
 * Password input with an inline show/hide eye toggle.
 *
 * Drop-in replacement for `<input type="password" ... />` — accepts the same
 * props (value, onChange, required, autoComplete, placeholder, className,
 * style, onFocus, onBlur, etc.) and renders them on the underlying <input>.
 *
 * The visible icon is 20x20 but the tap target is a 44x44 button (iPad-friendly).
 * The input's right padding is reserved so typed text never overlaps the icon.
 *
 * Toggle state is per-component-instance and resets to "hidden" on every mount
 * — no persistence across page reloads.
 */
const PasswordInput = forwardRef(function PasswordInput(
  { className = '', style = {}, toggleColor = '#9a8080', ...inputProps },
  ref
) {
  const [visible, setVisible] = useState(false)
  const mergedStyle = { paddingRight: 44, ...style }

  return (
    <div className="relative w-full">
      <input
        ref={ref}
        {...inputProps}
        type={visible ? 'text' : 'password'}
        className={className}
        style={mergedStyle}
      />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible(v => !v)}
        // 44x44 touch target, icon visually centered inside.
        className="absolute right-0 top-1/2 w-11 h-11 flex items-center justify-center transition-opacity"
        style={{
          transform: 'translateY(-50%)',
          color:     toggleColor,
          opacity:   0.7,
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
        tabIndex={-1}
      >
        {visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
    </div>
  )
})

export default PasswordInput
