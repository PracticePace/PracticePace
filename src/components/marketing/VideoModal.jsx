// ─────────────────────────────────────────────────────────────────────────────
// VideoModal — full-screen dark overlay with a video player area centered.
//
// STUB SCOPE (Commit 2): the modal renders a "Demo video coming soon."
// placeholder — the real demo asset lands in a later commit. Reusable
// by any marketing page that wants a demo trigger; HomePage uses it
// both from the hero "Watch Demo" button and from the Section 3 play-
// button overlay on the video preview thumbnail.
//
// Close paths (all three per spec):
//   • Escape key → close
//   • ✕ button top-right → close
//   • Backdrop click (outside the inner video-area) → close
//
// Body scroll is locked while the modal is open so scroll-through
// doesn't reveal a moving page behind the overlay.
//
// PROPS
//   open      — boolean; render only when true (returns null otherwise).
//   onClose() — fires on any of the three close paths above.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'

export default function VideoModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    // Lock body scroll while the modal is open, restore on close/unmount.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.94)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Practice:Pace demo video"
    >
      <div
        className="relative w-full max-w-5xl rounded-lg flex items-center justify-center"
        // Standard 16:9 video aspect. Inner click swallowed so the
        // backdrop-close handler above only fires for clicks OUTSIDE
        // this box.
        style={{ aspectRatio: '16 / 9', backgroundColor: '#0d0000' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close video"
          className="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-white text-xl transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
        >
          ✕
        </button>
        <p
          className="font-body text-center px-6"
          style={{ color: 'rgba(255,255,255,0.72)', fontSize: '1rem' }}
        >
          Demo video coming soon.
        </p>
      </div>
    </div>
  )
}
