export const SESSIONS_FEATURE = "sessions" as const;

// Qualified write handler names — entity prefix is "userSession", snake_case
// "user_session" on the wire.
export const SessionHandlers = {
  revoke: "sessions:write:user-session:revoke",
  revokeAllOthers: "sessions:write:user-session:revoke-all-others",
  /** Privileged: System-Caller (cross-feature) revokes ALL live sessions
   *  fuer einen User. Genutzt von user-data-rights:restrict-account
   *  (DSGVO Art. 18 Account-Freeze). */
  revokeAllForUser: "sessions:write:user-session:revoke-all-for-user",
} as const;

export const SessionQueries = {
  // User-scoped: "my live sessions" (other devices/browsers)
  mine: "sessions:query:user-session:mine",
  // Admin-scoped: all sessions in the caller's tenant (live + revoked).
  // Tenant isolation comes from ctx.db; access-gate is admin-or-higher.
  list: "sessions:query:user-session:list",
} as const;

export const SessionErrors = {
  // Returned by session:revoke when the sid is already revoked. Distinct
  // from ownership_denied so the UI can say "this session was already
  // logged out at <time>" instead of a generic access error. Revealing an
  // already-revoked sid's state to its owner is not a leak (they already
  // know it was their session).
  alreadyRevoked: "session_already_revoked",
  // "sign out everywhere else" called without a current session on the JWT.
  // Stateless-JWT deployments can't express "everywhere else", so we refuse
  // rather than interpret the request as "nuke everything including me".
  sessionRequired: "session_required",
  // Handler reuses the framework-wide ownership_denied reason (kept here as
  // a constant so the handler's constructor-arg and the test's assertion
  // read from the same source).
  ownershipDenied: "ownership_denied",
} as const;

// Default cache TTL in milliseconds. 60s keeps DB load down while still
// surfacing revocations within a minute. Tests override to 0 for determinism.
export const DEFAULT_SESSION_CACHE_TTL_MS = 60_000;

// Default session lifetime — 30 days. Mirrors typical "remember me" windows
// and matches the JWT 24h refresh story (JWT expires sooner, session lives
// longer so refresh can rotate the token without requiring a new password).
// MVP ships a single window; per-app overrides can come later.
export const DEFAULT_SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
