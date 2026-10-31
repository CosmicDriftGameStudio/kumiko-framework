import { unprocessable } from "../shared/index.ts";
import { AuthErrors } from "./web/constants.ts";

// @wrapper-known error-helper
export function invalidCredentials() {
  return unprocessable(AuthErrors.invalidCredentials, "auth.errors.invalidCredentials");
}

// @wrapper-known error-helper
export function invalidInviteToken() {
  return unprocessable(AuthErrors.invalidInviteToken, "auth.errors.invalidInviteToken");
}

// @wrapper-known error-helper
export function inviteEmailMismatch() {
  return unprocessable(AuthErrors.inviteEmailMismatch, "auth.errors.inviteEmailMismatch");
}

// @wrapper-known error-helper
export function inviteAlreadyAccepted() {
  return unprocessable(AuthErrors.inviteAlreadyAccepted, "auth.errors.inviteAlreadyAccepted");
}

// @wrapper-known error-helper
export function invalidResetToken() {
  return unprocessable(AuthErrors.invalidResetToken, "auth.errors.invalidResetToken");
}

// @wrapper-known error-helper
export function invalidUnlockToken() {
  return unprocessable(AuthErrors.invalidUnlockToken, "auth.errors.invalidUnlockToken");
}

// @wrapper-known error-helper
export function invalidVerificationToken() {
  return unprocessable(AuthErrors.invalidVerificationToken, "auth.errors.invalidVerificationToken");
}

// @wrapper-known error-helper
export function invalidSignupToken() {
  return unprocessable(AuthErrors.invalidSignupToken, "auth.errors.invalidSignupToken");
}

// @wrapper-known error-helper
export function signupEmailAlreadyRegistered() {
  return unprocessable(
    AuthErrors.signupEmailAlreadyRegistered,
    "auth.errors.signupEmailAlreadyRegistered",
  );
}

// @wrapper-known error-helper
export function noMembership() {
  return unprocessable(AuthErrors.noMembership, "auth.errors.noMembership");
}

// @wrapper-known error-helper
export function emailNotVerified() {
  return unprocessable(AuthErrors.emailNotVerified, "auth.errors.emailNotVerified");
}

// retryAfterSeconds drives the login/signup UI countdown — must stay > 0.
// @wrapper-known error-helper
export function accountLocked(retryAfterSeconds: number) {
  return unprocessable(AuthErrors.accountLocked, "auth.errors.accountLocked", {
    retryAfterSeconds,
  });
}

// @wrapper-known error-helper
export function accountRestricted() {
  return unprocessable(AuthErrors.accountRestricted, "auth.errors.accountRestricted");
}
