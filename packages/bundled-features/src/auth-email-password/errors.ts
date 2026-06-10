import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { AuthErrors } from "./constants";

export function invalidCredentials() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidCredentials, {
      i18nKey: "auth.errors.invalidCredentials",
    }),
  );
}

export function invalidInviteToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidInviteToken, {
      i18nKey: "auth.errors.invalidInviteToken",
    }),
  );
}

export function invalidResetToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidResetToken, {
      i18nKey: "auth.errors.invalidResetToken",
    }),
  );
}

export function invalidVerificationToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidVerificationToken, {
      i18nKey: "auth.errors.invalidVerificationToken",
    }),
  );
}

export function invalidSignupToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidSignupToken, {
      i18nKey: "auth.errors.invalidSignupToken",
    }),
  );
}

export function noMembership() {
  return writeFailure(
    new UnprocessableError(AuthErrors.noMembership, {
      i18nKey: "auth.errors.noMembership",
    }),
  );
}

export function emailNotVerified() {
  return writeFailure(
    new UnprocessableError(AuthErrors.emailNotVerified, {
      i18nKey: "auth.errors.emailNotVerified",
    }),
  );
}

// retryAfterSeconds drives the login/signup UI countdown — must stay > 0.
export function accountLocked(retryAfterSeconds: number) {
  return writeFailure(
    new UnprocessableError(AuthErrors.accountLocked, {
      i18nKey: "auth.errors.accountLocked",
      details: { retryAfterSeconds },
    }),
  );
}

export function accountRestricted() {
  return writeFailure(
    new UnprocessableError(AuthErrors.accountRestricted, {
      i18nKey: "auth.errors.accountRestricted",
    }),
  );
}
