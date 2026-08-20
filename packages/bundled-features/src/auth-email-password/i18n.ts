// @runtime client
// English UI copy for this feature. emailPasswordClient() mounts it as a
// LocaleProvider fallback. Apps override keys via
// `emailPasswordClient({ translations })`. German/Spanish ship in
// localeDeClient() / localeEsClient(), not in this bundle.
//
// Keys: `auth.<area>.<slug>` — `auth.login.*` for the form,
// `auth.errors.*` for login-handler reason codes (mirrors AuthErrors).

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "auth.login.title": "Sign in",
    "auth.login.email": "Email",
    "auth.login.password": "Password",
    "auth.login.submit": "Sign in",
    "auth.login.submitting": "…",
    "auth.login.forgotPassword": "Forgot password?",
    "auth.login.unlockAccount": "Unlock account?",
    "auth.login.resendVerification": "Send verification email again",
    "auth.login.resendSuccess": "We've sent you a new verification email.",
    "auth.login.resendRateLimited": "Please wait a moment and try again.",
    "auth.login.resendError": "Could not send. Please try again.",
    "auth.errors.invalidCredentials": "Invalid email or password.",
    "auth.errors.noMembership": "This account has no tenant access.",
    "auth.errors.accountLocked": "Account temporarily locked.",
    "auth.errors.accountLockedRetry": "Account locked. Try again in {minutes} minutes.",
    "auth.errors.emailNotVerified": "Email address not yet verified.",
    "auth.errors.accountRestricted":
      "Account paused (GDPR Art. 18). Please lift the restriction to sign in again.",
    "auth.errors.rateLimited": "Too many login attempts. Please wait briefly.",
    "auth.errors.invalidBody": "Invalid input.",
    "auth.errors.loginFailed": "Login failed.",
    "auth.errors.mfaNotSupported":
      "This app doesn't support two-factor verification. Please contact support.",
    "auth.errors.mfaSetupRequired":
      "Two-factor authentication required. Please contact your administrator.",
    "auth.errors.invalidResetToken": "Link is invalid or expired. Please request a new one.",
    "auth.errors.invalidVerificationToken": "Verification link is invalid or expired.",
    "auth.errors.invalidUnlockToken":
      "Unlock link is invalid or expired. Please request a new one.",
    "auth.errors.invalidSignupToken":
      "Activation link is invalid or expired. Please request a new one.",
    "auth.errors.signupEmailAlreadyRegistered":
      "An account already exists for this email. Please sign in or reset your password.",
    "auth.errors.unknownError": "Something went wrong. Please try again.",
    "auth.errors.originNotAllowed": "Requests from this origin are not allowed.",
    "auth.forgotPassword.title": "Reset password",
    "auth.forgotPassword.intro":
      "Enter your email. If an account exists, we'll send you a reset link.",
    "auth.forgotPassword.email": "Email",
    "auth.forgotPassword.submit": "Request link",
    "auth.forgotPassword.submitting": "…",
    "auth.forgotPassword.successTitle": "Email sent",
    "auth.forgotPassword.successBody":
      "If your email exists in our system, a reset link is on its way. Please check your inbox.",
    "auth.forgotPassword.backToLogin": "Back to sign in",
    "auth.resetPassword.title": "Set new password",
    "auth.resetPassword.intro": "Choose a new password (at least 8 characters).",
    "auth.resetPassword.newPassword": "New password",
    "auth.resetPassword.confirmPassword": "Confirm password",
    "auth.resetPassword.mismatch": "Passwords do not match.",
    "auth.resetPassword.tooShort": "Password must be at least 8 characters.",
    "auth.resetPassword.submit": "Save password",
    "auth.resetPassword.submitting": "…",
    "auth.resetPassword.successTitle": "Password set",
    "auth.resetPassword.successBody": "You can now sign in with your new password.",
    "auth.resetPassword.goToLogin": "Go to sign in",
    "auth.resetPassword.missingToken": "Reset link is missing a token. Please request a new one.",
    "auth.verifyEmail.verifying": "Verifying email …",
    "auth.verifyEmail.successTitle": "Email verified",
    "auth.verifyEmail.successBody": "Thanks! You can sign in now.",
    "auth.verifyEmail.errorTitle": "Verification failed",
    "auth.verifyEmail.errorBody":
      "Link is invalid or expired. Please request a new verification email.",
    "auth.verifyEmail.goToLogin": "Go to sign in",
    "auth.verifyEmail.missingToken": "Verification link is missing a token.",
    "auth.requestUnlock.title": "Unlock account",
    "auth.requestUnlock.intro":
      "Enter your email address. If your account is locked, we'll send you an unlock link.",
    "auth.requestUnlock.email": "Email",
    "auth.requestUnlock.submit": "Request link",
    "auth.requestUnlock.submitting": "…",
    "auth.requestUnlock.successTitle": "Email sent",
    "auth.requestUnlock.successBody":
      "If that email exists in our system and is locked, a message with an unlock link is on its way. Please check your inbox.",
    "auth.requestUnlock.backToLogin": "Back to sign in",
    "auth.requestUnlock.rateLimited": "Too many requests. Try again in {minutes} minutes.",
    "auth.unlockAccount.verifying": "Unlocking account …",
    "auth.unlockAccount.successTitle": "Account unlocked",
    "auth.unlockAccount.successBody": "Your account is unlocked again. You can sign in now.",
    "auth.unlockAccount.errorTitle": "Unlock failed",
    "auth.unlockAccount.errorBody": "Link is invalid or expired. Please request a new unlock link.",
    "auth.unlockAccount.goToLogin": "Go to sign in",
    "auth.unlockAccount.missingToken": "Unlock link is missing a token.",
    "auth.signup.title": "Create account",
    "auth.signup.intro":
      "Enter your email. We'll send you an activation link to set your password.",
    "auth.signup.email": "Email",
    "auth.signup.submit": "Send activation link",
    "auth.signup.submitting": "…",
    "auth.signup.successTitle": "Email sent",
    "auth.signup.successBody":
      "We've sent you an activation link. Click it to set your password and sign in.",
    "auth.signup.resend": "Send email again",
    "auth.signup.haveAccount": "Already have an account? Sign in",
    "auth.signupComplete.title": "Set password",
    "auth.signupComplete.intro": "Choose a password (at least 8 characters) for your new account.",
    "auth.signupComplete.password": "Password",
    "auth.signupComplete.confirmPassword": "Confirm password",
    "auth.signupComplete.tooShort": "Password must be at least 8 characters.",
    "auth.signupComplete.mismatch": "Passwords do not match.",
    "auth.signupComplete.submit": "Activate account",
    "auth.signupComplete.submitting": "…",
    "auth.signupComplete.missingToken":
      "Activation link is missing a token. Please request a new one.",
    "auth.signupComplete.activated": "Your account is active and you're signed in.",
    "auth.signupComplete.continue": "Continue",
    "auth.inviteAccept.title": "Accept invitation",
    "auth.inviteAccept.intro": "You've been invited to a workspace. Click 'Accept' to join.",
    "auth.inviteAccept.loggedInAs": "Signed in as {email}",
    "auth.inviteAccept.email": "Email",
    "auth.inviteAccept.password": "Password",
    "auth.inviteAccept.acceptButton": "Accept",
    "auth.inviteAccept.submit": "Accept + sign in",
    "auth.inviteAccept.submitting": "…",
    "auth.inviteAccept.useOtherAccount": "Sign in with a different account",
    "auth.inviteAccept.toggleNew": "I don't have an account yet",
    "auth.inviteAccept.toggleExisting": "I already have an account",
    "auth.inviteAccept.missingToken": "The invitation link is missing or invalid.",
    "auth.inviteAccept.goToLogin": "Go to sign in",
    "auth.user.menu.label": "Account",
    "auth.user.menu.logout": "Sign out",
    "auth.tenant.switcher.label": "Tenant",
    "auth.tenant.switcher.none": "No tenant",
  },
};

// Kanonische Implementierung lebt jetzt im Renderer (neben
// TranslationsByLocale) — Re-Export hält die bestehende Import-Surface
// (auth-email-password/web) stabil.
export { mergeTranslations } from "@cosmicdrift/kumiko-renderer";
