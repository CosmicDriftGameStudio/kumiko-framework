// @runtime client
// Shared error-code → i18n-key mapping for the account-management write
// handlers (enable-confirm/disable/regenerate-recovery) — distinct from
// mfa-verify-screen.tsx's own mapper, which covers the login-challenge
// error surface (challenge_expired/rate_limited) that these handlers never
// return. Centralized so enable/disable/regenerate stay in sync instead of
// each re-deriving the key ad hoc (enable-screen used to template-string
// the raw snake_case code straight into the key, which never matched the
// camelCase keys actually registered below).
import { AuthMfaErrorCodes } from "../constants";

export function mfaManageErrorKey(code: string): string {
  switch (code) {
    case AuthMfaErrorCodes.invalidTotpCode:
      return "auth.mfa.errors.invalidCode";
    case AuthMfaErrorCodes.invalidRecoveryCode:
      return "auth.mfa.errors.invalidRecoveryCode";
    case AuthMfaErrorCodes.mfaAlreadyEnabled:
      return "auth.mfa.errors.mfaAlreadyEnabled";
    case AuthMfaErrorCodes.mfaNotEnabled:
      return "auth.mfa.errors.mfaNotEnabled";
    case AuthMfaErrorCodes.invalidSetupToken:
      return "auth.mfa.errors.invalidSetupToken";
    case AuthMfaErrorCodes.setupFailed:
      return "auth.mfa.errors.setupFailed";
    default:
      return "auth.mfa.errors.verifyFailed";
  }
}
