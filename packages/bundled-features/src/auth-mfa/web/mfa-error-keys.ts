// Shared error-code → i18n-key mapping for the account-management write
// handlers (enable-confirm/disable/regenerate-recovery) — distinct from
// mfa-verify-screen.tsx's own mapper, which covers the login-challenge
// error surface (challenge_expired/rate_limited) that these handlers never
// return. Centralized so enable/disable/regenerate stay in sync instead of
// each re-deriving the key ad hoc (enable-screen used to template-string
// the raw snake_case code straight into the key, which never matched the
// camelCase keys actually registered below).
export function mfaManageErrorKey(code: string): string {
  switch (code) {
    case "invalid_totp_code":
      return "auth.mfa.errors.invalidCode";
    case "invalid_recovery_code":
      return "auth.mfa.errors.invalidRecoveryCode";
    case "mfa_already_enabled":
      return "auth.mfa.errors.mfaAlreadyEnabled";
    case "mfa_not_enabled":
      return "auth.mfa.errors.mfaNotEnabled";
    case "invalid_setup_token":
      return "auth.mfa.errors.invalidSetupToken";
    default:
      return "auth.mfa.errors.verifyFailed";
  }
}
