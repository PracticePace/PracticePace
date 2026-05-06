# Standing instructions for Claude Code on this repo

## Remote configuration

The deployed app is served from the `practicepace` remote, which is `git@github-practicepace:PracticePace/PracticePace.git` (SSH alias configured in ~/.ssh/config on this machine). Vercel auto-deploys from `practicepace/main`.

The `origin` remote points at the maintainer's personal GitHub account (`git@github.com:mbrooks0918-maker/PracticePace.git`). It is NOT connected to Vercel and pushing to it does NOT deploy. It is being kept temporarily for history but will eventually be archived.

Default push behavior:
- For all production work, push to `practicepace`, not `origin`.
- Always run `git remote -v` at the start of any task that involves pushing, to confirm both remotes exist and to confirm the URLs match the above.
- If `practicepace` is missing, STOP and tell the user — do not attempt to recreate it without explicit instruction.
- Do NOT add new remotes. Do NOT embed access tokens in any remote URL. The `practicepace` remote uses SSH and works without tokens.

## Verifying every push

Every task that involves writing code MUST end with a verified push to `practicepace/main`. Do not tell the user a task is complete until you have:

1. Run `git status` and confirmed the working tree is clean (everything committed).
2. Run `git push practicepace main` and shown the user the LITERAL terminal output, including the `<old hash>..<new hash>  main -> main` line that confirms the push moved the remote forward.
3. Run `git log practicepace/main --oneline -3` and shown the user the literal output, with the new commit at the top.
4. If working in a git worktree or feature branch, merge into main and push main BEFORE claiming the task is done. Worktree branches and unmerged feature branches do not count as deployed.
5. If `git push` fails for any reason — auth, non-fast-forward, network, anything — STOP and tell the user the literal error message. Do not retry silently. Do not claim the task succeeded.
6. After a successful push, tell the user: "Pushed to practicepace/main as commit <hash>. Vercel will auto-deploy in ~1 minute. Hard refresh the browser to test."

## Things that do NOT count as a deploy
- "Verified in the local Vite preview"
- "Edits live on this branch"
- "Pushed" (without showing the user the git output)
- A commit on any branch other than main
- A commit in a worktree that hasn't been merged
- A push to `origin` (which is the personal repo, not connected to Vercel)
- A push to any remote other than `practicepace`

## Database migrations

This repo uses Supabase for both auth and data, currently across two projects (per known issue #1 in the project notes). The Supabase CLI is NOT wired up to push migrations automatically. When you create a migration file under supabase/migrations/, you MUST also output the exact SQL block separately at the end of your response, in a fenced block, so the user can paste it into the Supabase Dashboard → SQL Editor manually. Tell the user clearly which Supabase project (auth or data) the SQL belongs in. Failing to do this means the migration file ships in code but never runs against the database.
