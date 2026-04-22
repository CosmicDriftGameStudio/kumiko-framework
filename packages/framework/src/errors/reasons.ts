// Centralized registry of the reason codes the framework itself surfaces via
// `details.reason`. Declaring them here keeps them typed + greppable, and
// gives features a single source of truth when they need to branch on the
// framework-level reason (e.g. "is this a stale-state race? retry once").
//
// Features add their own local Reasons objects (see `samples/errors/` or
// `packages/bundled-features/src/tenant/constants.ts` → TenantErrors). The
// framework deliberately does NOT enforce uniqueness across features — two
// features may use the same reason string if the semantics match. The
// convention: snake_case, no spaces, no feature prefix for framework reasons.

export const FrameworkReasons = {
  // ConflictError: atomic UPDATE lost the race (another writer moved the row
  // between our snapshot and our WHERE clause). Client SDK default: toast +
  // re-fetch.
  staleState: "stale_state",

  // UnprocessableError: guardTransition rejected a state-machine transition.
  // Details carry `from`, `to`, and `validTargets` for debugging.
  invalidTransition: "invalid_transition",

  // AccessDeniedError: dispatcher's field-level write check blocked a field.
  // Details carry `field` and `handler`.
  fieldAccessDenied: "field_access_denied",

  // ConflictError: cascade-delete guard refused because dependent rows exist.
  // Details carry `blockingEntity`, `entity`, `entityId`.
  deleteRestricted: "delete_restricted",
} as const;

export type FrameworkReason = (typeof FrameworkReasons)[keyof typeof FrameworkReasons];
