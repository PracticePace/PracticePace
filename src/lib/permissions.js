// ── Shared role-based permission helpers ─────────────────────────────────────
// Mirrors the role gates we enforce in RLS (see migrations
// 20260515000000_p0_security_fixes_rls.sql and
// 20260516000000_rename_roles_to_athletic_terms.sql). UI hides destructive
// controls so a team_manager never taps a button that would just bounce off
// RLS with an ugly "violates row-level security policy" error.
//
// Role names use athletic terminology (refactor from Commit 2a, dated
// 2026-05-16):
//   ad               — Athletic Director (formerly 'owner')
//   head_coach       — Head Coach        (formerly 'admin')
//   assistant_coach  — Assistant Coach   (formerly 'coach')
//   team_manager     — Team Manager      (formerly 'readonly')
//
// canEdit(role) — true for any role allowed to mutate program content
// (ad / head_coach / assistant_coach). False for 'team_manager' (and
// false-y for any missing / unknown role too, defensive).
//
// canAdminister(role) — true for ad / head_coach only. Used for org-level
// settings (Program Settings, Program Logo, Practice Screen Background).
//
// canManageBilling(role) — ad only. Used for Subscription & Billing.
//
// These are CLIENT-side UX helpers. The database-side RLS policies are
// the actual security boundary (see migrations above); these helpers exist
// solely to keep the UI honest about what a given role can do without
// triggering RLS rejections.

export function canEdit(role) {
  return role === 'ad' || role === 'head_coach' || role === 'assistant_coach'
}

export function canAdminister(role) {
  return role === 'ad' || role === 'head_coach'
}

export function canManageBilling(role) {
  return role === 'ad'
}

// ── Scoreboard gates ─────────────────────────────────────────────────────────
// The scoreboard splits into two layers:
//   • OPERATE — the in-game controls (run the clock, +/- score, period,
//                 down/distance, possession, timeouts). All four real roles
//                 can operate, including team_manager — that's exactly the
//                 "I'm running the scoreboard during the game" use case
//                 a manager-tier role is here for.
//   • CONFIGURE — picking the sport / scoreboard layout. Gated to
//                 ad + head_coach. Assistant coaches can pick within an
//                 already-configured scoreboard (that's still "operate"
//                 territory) but can't choose which scoreboard surface
//                 to open.
//
// Both helpers return false for missing / unknown role (defensive — a
// not-yet-loaded profile gets neither permission, which keeps the UI
// from flashing inconsistent state during AuthContext's initial load).
export function canOperateScoreboard(role) {
  return role === 'ad'
      || role === 'head_coach'
      || role === 'assistant_coach'
      || role === 'team_manager'
}

export function canConfigureScoreboard(role) {
  return role === 'ad' || role === 'head_coach'
}

// ── Coach-management gates ───────────────────────────────────────────────────
// Decide whether VIEWER is allowed to remove TARGET from the Coaches & Staff
// list. Both arguments are profile shapes — must carry { id, role, org_id }.
// Mirrors the profiles DELETE RLS policy from migration 20260518000000;
// keep them in sync.
//
// Rules:
//   • Cannot remove yourself via this UI (self-delete is a different flow).
//   • AD can remove anyone in their account (RLS handles the account scope;
//     this helper just trusts the caller is consistent).
//   • head_coach can remove SAME-ORG non-AD members. Cannot remove the AD;
//     cannot remove cross-program peers.
//   • assistant_coach / team_manager / no-role cannot remove anyone.
export function canRemoveCoach(viewer, target) {
  if (!viewer || !target) return false
  if (viewer.id === target.id) return false
  if (viewer.role === 'ad') return true
  if (viewer.role === 'head_coach') {
    if (target.role === 'ad') return false
    if (viewer.org_id !== target.org_id) return false
    return true
  }
  return false
}

// Decide whether VIEWER can edit TARGET's role via the inline dropdown.
// Same rules as canRemoveCoach with one subtlety: an AD editing their
// own role is allowed at the DB layer (the self-update policy permits
// it), so we DON'T gate self-edit here. If you want a UI guard against
// the AD demoting themselves, add a confirmation dialog in the caller —
// don't bake it into this helper.
export function canEditCoachRole(viewer, target) {
  if (!viewer || !target) return false
  if (viewer.role === 'ad') return true
  if (viewer.role === 'head_coach') {
    if (viewer.id === target.id) return false   // head_coach can't edit own role here
    if (target.role === 'ad') return false
    if (viewer.org_id !== target.org_id) return false
    return true
  }
  return false
}

// ── User-facing role labels ──────────────────────────────────────────────────
// The DB stores the canonical snake_case value; the UI shows a friendly
// Title-Case label.
//
// `ad` is the one role with a context-dependent label. Real-world athletic
// directors typically only exist at schools running multiple programs
// (football + basketball + volleyball + …). For a single-program account
// where the same person is both the AD and the head coach in practice, we
// show "Head Coach" instead of "Athletic Director" so the UI doesn't read
// as bigger than the situation. The DB value stays 'ad' either way — this
// is purely a display decision.
//
// Pass `isMultiProgram = true` when the account has 2+ organizations
// (i.e. the AD label is actually meaningful).
export function roleLabel(role, isMultiProgram = false) {
  switch (role) {
    case 'ad':              return isMultiProgram ? 'Athletic Director' : 'Head Coach'
    case 'head_coach':      return 'Head Coach'
    case 'assistant_coach': return 'Assistant Coach'
    case 'team_manager':    return 'Team Manager'
    default:                return role ?? ''
  }
}
