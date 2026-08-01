import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Scrolls the window to the top whenever the route changes.
 * Renders nothing. Must be a descendant of <BrowserRouter>.
 *
 * Skips scroll-to-top when only the URL hash changes (anchor links
 * stay put) because the effect depends on pathname alone.
 *
 * Also flips `history.scrollRestoration` to 'manual' so that browser
 * back/forward navigations trigger our own scroll-to-top instead of
 * the browser restoring the previous scroll position. Without this,
 * Chrome's automatic scroll restoration wins the race after
 * `popstate` and the user lands mid-page on the back/forward target.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    // One-time: opt out of the browser's own scroll restoration so
    // back/forward doesn't undo our scrollTo below. Guarded because
    // `history.scrollRestoration` isn't in every environment (tests,
    // SSR, older browsers).
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  return null
}
