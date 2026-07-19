import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { AuthMfaErrorCodes } from "./constants";

export { AuthMfaErrorCodes as AuthMfaErrors } from "./constants";

export function mfaAlreadyEnabled(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrorCodes.mfaAlreadyEnabled, {
      i18nKey: "authMfa.errors.mfaAlreadyEnabled",
    }),
  );
}

export function mfaNotEnabled(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrorCodes.mfaNotEnabled, {
      i18nKey: "authMfa.errors.mfaNotEnabled",
    }),
  );
}

export function invalidSetupToken(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrorCodes.invalidSetupToken, {
      i18nKey: "authMfa.errors.invalidSetupToken",
    }),
  );
}

export function invalidTotpCode(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrorCodes.invalidTotpCode, {
      i18nKey: "authMfa.errors.invalidTotpCode",
    }),
  );
}

export function invalidRecoveryCode(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrorCodes.invalidRecoveryCode, {
      i18nKey: "authMfa.errors.invalidRecoveryCode",
    }),
  );
}

export function invalidChallengeToken(): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrorCodes.invalidChallengeToken, {
      i18nKey: "authMfa.errors.invalidChallengeToken",
    }),
  );
}

// retryAfterSeconds drives the login UI countdown — must stay > 0.
export function tooManyAttempts(retryAfterSeconds: number): WriteFailure {
  return writeFailure(
    new UnprocessableError(AuthMfaErrorCodes.tooManyAttempts, {
      i18nKey: "authMfa.errors.tooManyAttempts",
      details: { retryAfterSeconds },
    }),
  );
}
