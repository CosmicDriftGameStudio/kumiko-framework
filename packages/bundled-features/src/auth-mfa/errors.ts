import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { unprocessable } from "../shared/index.ts";
import { AuthMfaErrorCodes as Code } from "./web/constants.ts";

export { AuthMfaErrorCodes as AuthMfaErrors } from "./web/constants.ts";

export function mfaAlreadyEnabled(): WriteFailure {
  return unprocessable(Code.mfaAlreadyEnabled, "auth.mfa.errors.mfaAlreadyEnabled");
}

export function mfaNotEnabled(): WriteFailure {
  return unprocessable(Code.mfaNotEnabled, "auth.mfa.errors.mfaNotEnabled");
}

export function invalidSetupToken(): WriteFailure {
  return unprocessable(Code.invalidSetupToken, "auth.mfa.errors.invalidSetupToken");
}

export function invalidTotpCode(): WriteFailure {
  return unprocessable(Code.invalidTotpCode, "auth.mfa.errors.invalidTotpCode");
}

export function invalidRecoveryCode(): WriteFailure {
  return unprocessable(Code.invalidRecoveryCode, "auth.mfa.errors.invalidRecoveryCode");
}

export function invalidChallengeToken(): WriteFailure {
  return unprocessable(Code.invalidChallengeToken, "auth.mfa.errors.invalidChallengeToken");
}

// retryAfterSeconds drives the login UI countdown — must stay > 0.
export function tooManyAttempts(retryAfterSeconds: number): WriteFailure {
  return unprocessable(Code.tooManyAttempts, "auth.mfa.errors.tooManyAttempts", {
    retryAfterSeconds,
  });
}
