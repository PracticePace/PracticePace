# Supabase auth email templates

Supabase sends every transactional email in Practice:Pace — there is no Resend
or SendGrid in the stack. These are the branded replacements for its four
default templates.

## Installing

Supabase has no API for auth email templates, so these are pasted by hand:

Dashboard → **Authentication → Emails** → pick the template → paste the file
into the message body → Save.

| Supabase template | File |
|---|---|
| Confirm signup   | `confirm-signup.html` |
| Invite user      | `invite-user.html` |
| Reset password   | `reset-password.html` |
| Magic link       | `magic-link.html` |

## Why they look like this

Email clients are not browsers. Everything here is a table with inline styles
because Outlook and Gmail strip `<style>` blocks and ignore flexbox and grid.
Specifically:

- **The wordmark is text, not an image.** Most clients block remote images by
  default; a logo the reader has to approve a download to see is worse than
  type.
- **The button is a `<td bgcolor>` wrapping the `<a>`.** Outlook ignores
  padding on inline elements, so a styled anchor collapses into a bare
  underlined link.
- **Every colour is explicit, on a light ground.** Gmail's dark mode recolours
  anything left to the client default, which is how a brand red turns muddy.
- **The raw URL is printed under the button.** School and district mail
  gateways rewrite or strip buttons, and schools are the entire customer base.
- **A hidden preheader** sets the grey preview line next to the subject.
  Without one, clients show the first visible text — the wordmark.

## The link

All four link **directly at our own `/auth/callback`** carrying
`{{ .TokenHash }}`, not at `{{ .ConfirmationURL }}`:

| Template | Link |
|---|---|
| Confirm signup | `/auth/callback?token_hash=…&type=signup` |
| Invite user | `/auth/callback?next=%2Finvite&token_hash=…&type=invite` |
| Reset password | `/auth/callback?next=%2Freset-password&token_hash=…&type=recovery` |
| Magic link | `/auth/callback?token_hash=…&type=magiclink` |

**Do not "simplify" these back to `{{ .ConfirmationURL }}`.** That variable
points at Supabase's `/auth/v1/verify`, which spends the token on a GET —
and Gmail's link-safety prefetcher issues that GET before the coach ever
clicks, so the link is already dead when they do. A direct `token_hash` link
is only ever spent by `verifyOtp`, which is a POST no prefetcher will make.

It is also the only pattern that survives a link being opened on a different
device from the one that started the flow — routine for a coach who signs up
on a laptop and reads mail on a phone. A PKCE `?code=` needs a `code_verifier`
from the originating browser's localStorage; a `token_hash` needs nothing.
`/auth/callback` still handles `?code=` for any link already in flight, and
shows "Your email is confirmed. Log in to continue." when it can't be
exchanged.

`src/pages/AcceptInvite.jsx` and `src/pages/ResetPassword.jsx` run their own
`verifyOtp` and must receive the raw params; `/auth/callback` forwards those
two through untouched (`SELF_EXCHANGING_PATHS` in `src/lib/authRedirects.js`).

## Supabase URL configuration

Every URL the app hands to Supabase is listed in `src/lib/authRedirects.js`.
These must all be in Authentication → URL Configuration → Redirect URLs:

```
https://practicepace.app/auth/callback
https://practicepace.app/auth/callback?next=%2Finvite
https://practicepace.app/auth/callback?next=%2Freset-password
https://www.practicepace.app/auth/callback
```

The apex host 307s to `www` and preserves the query string, so the token
survives the hop; the `www` entry covers the post-redirect URL. The two
legacy entries (`/invite`, `/reset-password`) can stay until every link
already in an inbox has expired.

## Deliverability

Worth doing before onboarding a school: the default Supabase SMTP is heavily
rate-limited and sends from a Supabase-owned address with no SPF or DKIM on
`practicepace.app`. A school with fifteen coaches will throttle. Configure
custom SMTP under Project Settings → Auth. No code change — these templates are
unaffected.
