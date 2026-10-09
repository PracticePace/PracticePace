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

## The variable

All four use Supabase's `{{ .ConfirmationURL }}`, twice each: once on the
button, once as the copy-paste fallback. Supabase substitutes the correct
destination per template type, so the same variable covers confirmation,
invite, reset and magic link.

`{{ .ConfirmationURL }}` resolves against the project's **Site URL** and
**Redirect URLs** (Authentication → URL Configuration). The redirect targets the
app actually asks for are:

```
https://www.practicepace.app/invite            api/invite-coach.js, api/add-program.js
https://www.practicepace.app/reset-password    src/pages/Login.jsx
```

Both must be in the Redirect URLs allow-list or the link lands on the Site URL
instead.

## Deliverability

Worth doing before onboarding a school: the default Supabase SMTP is heavily
rate-limited and sends from a Supabase-owned address with no SPF or DKIM on
`practicepace.app`. A school with fifteen coaches will throttle. Configure
custom SMTP under Project Settings → Auth. No code change — these templates are
unaffected.
