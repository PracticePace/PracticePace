// ── authRedirects.js ──────────────────────────────────────────────────────────
// Every URL we hand to Supabase as a post-email destination, in one place.
//
// All of them point at /auth/callback. The callback is a router, not a
// terminus: it establishes the session, then forwards to wherever the link
// was actually meant to end up, carrying its params.
//
// WHY A CALLBACK AT ALL
// Sign-up passed no emailRedirectTo, so the confirm link used the project's
// Site URL and dropped the coach on the marketing home page — no session, no
// explanation, no way forward. And when a link opens in a different browser
// or on a different device from the one that signed up (routine: sign up on a
// laptop, open mail on a phone), a PKCE ?code= cannot be exchanged, because
// the code_verifier is in the ORIGINAL browser's localStorage. The callback is
// the one place that can notice that and say something useful instead of
// rendering a marketing page.
//
// HOST: apex, not www.
// practicepace.app 307s to www.practicepace.app and preserves the query
// string (verified against production), so the code or token survives the
// hop. Both hosts must be in Supabase's Redirect URLs allow-list — the
// allow-list is checked against the URL we SEND, which is the apex one.
//
// A NOTE ON localStorage AND THE REDIRECT
// apex and www are separate origins with separate localStorage. Because the
// app itself is only ever served from www (apex always redirects), the PKCE
// code_verifier is always written to www's storage, and the callback always
// runs on www after the hop. So the same-browser exchange works. If apex is
// ever made to serve the app directly, this stops being true and these should
// become www URLs.
const ORIGIN = 'https://practicepace.app'

export const AUTH_CALLBACK_URL = `${ORIGIN}/auth/callback`

// Paths the callback is allowed to forward to. A `next` that isn't in here is
// ignored — an open redirect on an auth callback hands an attacker a link that
// looks like ours and lands on theirs, with a live session in flight.
export const SAFE_NEXT_PATHS = new Set([
  '/invite',
  '/reset-password',
  '/dashboard',
  '/onboarding',
])

// Pages that do their OWN token exchange and must receive the raw params.
//
// AcceptInvite.jsx and ResetPassword.jsx both call verifyOtp({ token_hash })
// themselves, deliberately: verifyOtp is a POST, so Gmail's link-safety
// prefetcher can't consume the token by GET-ing the URL ahead of the coach.
// That behaviour was hard-won and is not re-implemented here. For these two
// the callback forwards token_hash and type untouched and gets out of the way.
export const SELF_EXCHANGING_PATHS = new Set(['/invite', '/reset-password'])

// ── The four destinations ────────────────────────────────────────────────────

// Sign-up confirmation and resend-confirmation. No `next`: where a brand-new
// coach belongs depends on whether they already have a profile, which the
// callback resolves after the session exists.
export const SIGNUP_REDIRECT = AUTH_CALLBACK_URL

// Password reset must still finish on the set-new-password screen.
export const RESET_PASSWORD_REDIRECT = `${AUTH_CALLBACK_URL}?next=%2Freset-password`

// Coach invites must still finish on AcceptInvite.
export const INVITE_REDIRECT = `${AUTH_CALLBACK_URL}?next=%2Finvite`

// Magic link, if one is ever added. Nothing calls signInWithOtp today.
export const MAGIC_LINK_REDIRECT = AUTH_CALLBACK_URL
