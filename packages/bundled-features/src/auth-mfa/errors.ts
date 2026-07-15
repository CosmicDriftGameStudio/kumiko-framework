import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";

export const AuthMfaErrors = {
  mfaAlreadyEnabled: "mfa_already_enabled",
  mfaNotEnabled: "mfa_not_enabled",
  invalidSetupToken: "invalid_setup_token",
  invalidTotpCode: "invalid_totp_code",
  invalidRecoveryCode: "invalid_recovery_code",
  invalidChallengeToken: "invalid_challenge_token",
  tooManyAttempts: "too_many_attempts",
} as const;

export function mfaAlreadyEnabled(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrors.mfaAlreadyEnabled, {
      i18nKey: "authMfa.errors.mfaAlreadyEnabled",
    }),
  );
}

export function mfaNotEnabled(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrors.mfaNotEnabled, {
      i18nKey: "authMfa.errors.mfaNotEnabled",
    }),
  );
}

export function invalidSetupToken(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrors.invalidSetupToken, {
      i18nKey: "authMfa.errors.invalidSetupToken",
    }),
  );
}

export function invalidTotpCode(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrors.invalidTotpCode, {
      i18nKey: "authMfa.errors.invalidTotpCode",
    }),
  );
}

export function invalidRecoveryCode(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrors.invalidRecoveryCode, {
      i18nKey: "authMfa.errors.invalidRecoveryCode",
    }),
  );
}

export function invalidChallengeToken(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrors.invalidChallengeToken, {
      i18nKey: "authMfa.errors.invalidChallengeToken",
    }),
  );
}

// retryAfterSeconds drives the login UI countdown — must stay > 0.
export function tooManyAttempts(retryAfterSeconds: number): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrors.tooManyAttempts, {
      i18nKey: "authMfa.errors.tooManyAttempts",
      details: { retryAfterSeconds },
    }),
  );
}
