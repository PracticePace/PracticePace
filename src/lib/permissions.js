// ── Shared role-based permission helpers ─────────────────────────────────────
// Mirrors the role gates we enforce in RLS (see the P0 security fixes
// migration 20260515000000_p0_security_fixes_rls.sql). UI hides
// destructive controls so a readonly coach never taps a button that
// would just bounce off RLS with an ugly "violates row-level security
// policy" error.
//
// canEdit(role) — true for any role allowed to mutate program content
// (owner / admin / coach). False for 'readonly' (and false-y for any
// missing / unknown role too, defensive).
//
// canAdminister(role) — true for owner / admin only. Used for org-level
// settings (Program Settings, Program Logo, Practice Screen Background).
//
// canManageBilling(role) — owner only. Used for Subscription & Billing.
//
// These are CLIENT-side UX helpers. The database-side RLS policies are
// the actual security boundary (see migration 20260515000000); these
// helpers exist solely to keep the UI honest about what a given role
// can do without triggering RLS rejections.

export function canEdit(role) {
  return role === 'owner' || role === 'admin' || role === 'coach'
}

export function canAdminister(role) {
  return role === 'owner' || role === 'admin'
}

export function canManageBilling(role) {
  return role === 'owner'
}
