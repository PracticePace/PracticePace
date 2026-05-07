// ── PracticePace Service Worker ───────────────────────────────────────────────
// Strategy:
//   • App shell (HTML / JS / CSS / fonts) — cache-first, install on activate
//   • Static assets (images, audio) — cache-first with network fallback
//   • API calls to Supabase, Stripe, Spotify — network-only (never cached)
//   • Everything else — network-first with cache fallback

// Bumping CACHE_NAME forces the SW activate handler below to delete every
// cache that doesn't match — which evicts the cached app shell HTML and
// stale Vite-hashed JS bundles. Bump this version on any deploy whose
// behavior change must reach already-installed clients (e.g. the invite
// flow fix in 90fcf89, which clients with the v1 cache never picked up
// because the cached '/' HTML kept loading the old bundle).
const CACHE_NAME = 'practicepace-v2'

// URLs that must ALWAYS go to the network (auth-sensitive or payment APIs)
const NETWORK_ONLY_ORIGINS = [
  'supabase.co',
  'stripe.com',
  'spotify.com',
  'accounts.spotify.com',
]

function isNetworkOnly(url) {
  try {
    const { hostname } = new URL(url)
    return NETWORK_ONLY_ORIGINS.some(
      origin => hostname === origin || hostname.endsWith('.' + origin)
    )
  } catch {
    return false
  }
}

// App-shell resources to pre-cache on install
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = request.url

  // Only handle GET requests
  if (request.method !== 'GET') return

  // Network-only: Supabase, Stripe, Spotify
  if (isNetworkOnly(url)) return

  // Network-only: our own API routes (/api/*)
  if (new URL(url).pathname.startsWith('/api/')) return

  // Static assets (images, audio, fonts) → cache-first
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|mp3|mp4|woff2?|ttf|otf)(\?.*)?$/.test(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // JS / CSS bundles (Vite fingerprinted) → cache-first
  if (/\.(js|css)(\?.*)?$/.test(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // Navigation requests (HTML) → network-first, fall back to cached '/'
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          return response
        })
        .catch(() => caches.match('/') )
    )
    return
  }

  // Everything else → network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request))
  )
})
