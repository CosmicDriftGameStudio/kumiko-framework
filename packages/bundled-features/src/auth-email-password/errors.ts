import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { AuthErrors } from "./constants";

// @wrapper-known error-helper
export function invalidCredentials() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidCredentials, {
      i18nKey: "auth.errors.invalidCredentials",
    }),
  );
}

// @wrapper-known error-helper
export function invalidInviteToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidInviteToken, {
      i18nKey: "auth.errors.invalidInviteToken",
    }),
  );
}

// @wrapper-known error-helper
export function inviteEmailMismatch() {
  return writeFailure(
    new UnprocessableError(AuthErrors.inviteEmailMismatch, {
      i18nKey: "auth.errors.inviteEmailMismatch",
    }),
  );
}

// @wrapper-known error-helper
export function invalidResetToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidResetToken, {
      i18nKey: "auth.errors.invalidResetToken",
    }),
  );
}

// @wrapper-known error-helper
export function invalidUnlockToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidUnlockToken, {
      i18nKey: "auth.errors.invalidUnlockToken",
    }),
  );
}

// @wrapper-known error-helper
export function invalidVerificationToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidVerificationToken, {
      i18nKey: "auth.errors.invalidVerificationToken",
    }),
  );
}

// @wrapper-known error-helper
export function invalidSignupToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidSignupToken, {
      i18nKey: "auth.errors.invalidSignupToken",
    }),
  );
}

// @wrapper-known error-helper
export function signupEmailAlreadyRegistered() {
  return writeFailure(
    new UnprocessableError(AuthErrors.signupEmailAlreadyRegistered, {
      i18nKey: "auth.errors.signupEmailAlreadyRegistered",
    }),
  );
}

// @wrapper-known error-helper
export function noMembership() {
  return writeFailure(
    new UnprocessableError(AuthErrors.noMembership, {
      i18nKey: "auth.errors.noMembership",
    }),
  );
}

// @wrapper-known error-helper
export function emailNotVerified() {
  return writeFailure(
    new UnprocessableError(AuthErrors.emailNotVerified, {
      i18nKey: "auth.errors.emailNotVerified",
    }),
  );
}

// retryAfterSeconds drives the login/signup UI countdown — must stay > 0.
// @wrapper-known error-helper
export function accountLocked(retryAfterSeconds: number) {
  return writeFailure(
    new UnprocessableError(AuthErrors.accountLocked, {
      i18nKey: "auth.errors.accountLocked",
      details: { retryAfterSeconds },
    }),
  );
}

// @wrapper-known error-helper
export function accountRestricted() {
  return writeFailure(
    new UnprocessableError(AuthErrors.accountRestricted, {
      i18nKey: "auth.errors.accountRestricted",
    }),
  );
}
