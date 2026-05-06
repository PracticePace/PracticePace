// ── Guest data layer ──────────────────────────────────────────────────────────
// All guest data lives in localStorage. Keys are prefixed with "pp_guest_".
// Nothing touches Supabase for guest (anonymous) users.

const SCRIPTS_KEY   = 'pp_guest_scripts'
const VIDEOS_KEY    = 'pp_guest_videos'
const ACTIVE_KEY    = 'pp_guest_active_id'

function uid() {
  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)) }
  catch { return fallback }
}

// ── Scripts ───────────────────────────────────────────────────────────────────

export function getGuestScripts() {
  return readJSON(SCRIPTS_KEY, [])
}

/** Creates or updates a script. Pass id to update, omit to create. */
export function saveGuestScript({ id, ...fields }) {
  const scripts = getGuestScripts()
  const now = new Date().toISOString()
  let result

  if (id) {
    result = { id, ...fields, updated_at: now }
    const next = scripts.map(s => s.id === id ? { ...s, ...result } : s)
    localStorage.setItem(SCRIPTS_KEY, JSON.stringify(next))
  } else {
    result = { id: uid(), ...fields, created_at: now, updated_at: now }
    localStorage.setItem(SCRIPTS_KEY, JSON.stringify([result, ...scripts]))
  }
  return result
}

export function deleteGuestScript(id) {
  const next = getGuestScripts().filter(s => s.id !== id)
  localStorage.setItem(SCRIPTS_KEY, JSON.stringify(next))
}

export function getGuestActiveId() {
  return localStorage.getItem(ACTIVE_KEY) ?? null
}

export function setGuestActiveId(id) {
  if (id) {
    console.log('[ACTIVE] localStorage write:', ACTIVE_KEY, '=', id, '(setGuestActiveId)')
    localStorage.setItem(ACTIVE_KEY, id)
  } else {
    console.log('[ACTIVE] localStorage clear:', ACTIVE_KEY, '(setGuestActiveId)')
    localStorage.removeItem(ACTIVE_KEY)
  }
}

// ── Videos ────────────────────────────────────────────────────────────────────

export function getGuestVideos() {
  return readJSON(VIDEOS_KEY, [])
}

export function addGuestVideo({ name, url }) {
  const video = { id: uid(), name, url, created_at: new Date().toISOString() }
  const next  = [video, ...getGuestVideos()]
  localStorage.setItem(VIDEOS_KEY, JSON.stringify(next))
  return video
}

export function deleteGuestVideo(id) {
  const next = getGuestVideos().filter(v => v.id !== id)
  localStorage.setItem(VIDEOS_KEY, JSON.stringify(next))
}

// ── Sample script seed ────────────────────────────────────────────────────────
// Called once on first guest login. Returns the active script.

export function seedGuestIfEmpty() {
  if (getGuestScripts().length > 0) return null // already seeded
  return saveGuestScript({
    name: 'Sample Practice — 90 min',
    sport: 'Football',
    drills: [
      { name: 'Warm Up & Stretch',     duration: 10 * 60 },
      { name: 'Individual / Position', duration: 20 * 60 },
      { name: 'Group / Unit Period',   duration: 15 * 60 },
      { name: 'Team Period',           duration: 25 * 60 },
      { name: 'Special Teams',         duration: 10 * 60 },
      { name: 'Conditioning',          duration:  8 * 60 },
      { name: 'Cool Down',             duration:  2 * 60 },
    ],
  })
}
