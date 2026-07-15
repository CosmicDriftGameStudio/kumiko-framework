// Qualified write-handler names — feature is registered as "auth-mfa", each
// short `name` below gets auto-prefixed to "auth-mfa:write:<name>" by
// r.writeHandler. Exported so cross-feature wiring (login.write.ts,
// run-prod-app.ts) can reference them without hardcoding the string.
export const AuthMfaHandlers = {
  enableStart: "auth-mfa:write:enable-start",
  enableConfirm: "auth-mfa:write:enable-confirm",
  disable: "auth-mfa:write:disable",
  regenerateRecovery: "auth-mfa:write:regenerate-recovery",
  verify: "auth-mfa:write:verify",
} as const;

export const MFA_SETUP_TOKEN_TTL_MINUTES = 10;
export const MFA_CHALLENGE_TOKEN_TTL_MINUTES = 10;
export const MFA_VERIFY_MAX_ATTEMPTS = 5;
export const MFA_VERIFY_LOCKOUT_MINUTES = 5;
