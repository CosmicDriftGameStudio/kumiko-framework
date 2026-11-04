import { unprocessable } from "../shared/index.ts";
import { AuthErrors } from "./web/constants.ts";

export function invalidCredentials() {
  return unprocessable(AuthErrors.invalidCredentials, "auth.errors.invalidCredentials");
}

export function invalidInviteToken() {
  return unprocessable(AuthErrors.invalidInviteToken, "auth.errors.invalidInviteToken");
}

export function inviteEmailMismatch() {
  return unprocessable(AuthErrors.inviteEmailMismatch, "auth.errors.inviteEmailMismatch");
}

export function inviteAlreadyAccepted() {
  return unprocessable(AuthErrors.inviteAlreadyAccepted, "auth.errors.inviteAlreadyAccepted");
}

export function invalidResetToken() {
  return unprocessable(AuthErrors.invalidResetToken, "auth.errors.invalidResetToken");
}

export function invalidUnlockToken() {
  return unprocessable(AuthErrors.invalidUnlockToken, "auth.errors.invalidUnlockToken");
}

export function invalidVerificationToken() {
  return unprocessable(AuthErrors.invalidVerificationToken, "auth.errors.invalidVerificationToken");
}

export function invalidSignupToken() {
  return unprocessable(AuthErrors.invalidSignupToken, "auth.errors.invalidSignupToken");
}

export function signupEmailAlreadyRegistered() {
  return unprocessable(
    AuthErrors.signupEmailAlreadyRegistered,
    "auth.errors.signupEmailAlreadyRegistered",
  );
}

export function noMembership() {
  return unprocessable(AuthErrors.noMembership, "auth.errors.noMembership");
}

export function emailNotVerified() {
  return unprocessable(AuthErrors.emailNotVerified, "auth.errors.emailNotVerified");
}

// retryAfterSeconds drives the login/signup UI countdown — must stay > 0.
export function accountLocked(retryAfterSeconds: number) {
  return unprocessable(AuthErrors.accountLocked, "auth.errors.accountLocked", {
    retryAfterSeconds,
  });
}

export function accountRestricted() {
  return unprocessable(AuthErrors.accountRestricted, "auth.errors.accountRestricted");
}
