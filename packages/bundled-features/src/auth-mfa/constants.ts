// @runtime client
// Pure constants — client-marked so auth-mfa/web/ may import handler QNs
// and the screen id without pulling the feature's server runtime barrel.
// Qualified write-handler names — feature is registered as "auth-mfa", each
// short `name` below gets auto-prefixed to "auth-mfa:write:<name>" by
// r.writeHandler. Exported so cross-feature wiring (login.write.ts,
// run-prod-app.ts) can reference them without hardcoding the string.
export const AUTH_MFA_FEATURE = "auth-mfa" as const;

export const AuthMfaHandlers = {
  enableStart: "auth-mfa:write:enable-start",
  enableConfirm: "auth-mfa:write:enable-confirm",
  disable: "auth-mfa:write:disable",
  regenerateRecovery: "auth-mfa:write:regenerate-recovery",
  verify: "auth-mfa:write:verify",
} as const;

export const AuthMfaQueries = {
  status: "auth-mfa:query:user-mfa:status",
} as const;

// Write-failure codes minted server-side into UnprocessableError (errors.ts).
// The client reads the i18n key straight off the write result
// (res.error.i18nKey) instead of re-deriving it from these codes.
export const AuthMfaErrorCodes = {
  mfaAlreadyEnabled: "mfa_already_enabled",
  mfaNotEnabled: "mfa_not_enabled",
  invalidSetupToken: "invalid_setup_token",
  invalidTotpCode: "invalid_totp_code",
  invalidRecoveryCode: "invalid_recovery_code",
  invalidChallengeToken: "invalid_challenge_token",
  tooManyAttempts: "too_many_attempts",
} as const;

export const MFA_SETUP_TOKEN_TTL_MINUTES = 10;
export const MFA_CHALLENGE_TOKEN_TTL_MINUTES = 10;
export const MFA_VERIFY_MAX_ATTEMPTS = 5;
export const MFA_VERIFY_LOCKOUT_MINUTES = 5;

// Dormant custom-screen id — see personal-access-tokens/feature.ts for the
// same convention. App places it via r.nav in its logged-in settings area.
export const MFA_ENABLE_SCREEN_ID = "auth-mfa-enable";
