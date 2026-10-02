// @runtime client
// Public exports für die Browser-Seite des auth-email-password Features.
// Wird über den Sub-Path-Export `@cosmicdrift/kumiko-bundled-features/auth-email-
// password/web` konsumiert — die Server-Seite (defineFeature) lebt in
// `@cosmicdrift/kumiko-bundled-features/auth-email-password` und hat keine
// React-/DOM-Deps. Trennung bleibt sauber so wie renderer vs renderer-web.

export { defaultTranslations, mergeTranslations } from "../i18n.js";
export type {
  AuthTokenFailure,
  CurrentUserProfile,
  LoginFailure,
  LoginRequest,
  LoginResponse,
  ResetPasswordFailure,
  SignupConfirmSuccess,
  TenantSummary,
  VerifyEmailFailure,
} from "./auth-client.js";
export {
  AuthRequestError,
  confirmAccountUnlock,
  confirmSignup,
  requestAccountUnlock,
  requestEmailVerification,
  requestPasswordReset,
  requestSignup,
  resetPassword,
  toLoginResponse,
  verifyEmail,
} from "./auth-client.js";
export type { AuthCardProps, AuthShellRenderer } from "./auth-form-primitives.js";
export { AuthCard, AuthShellProvider, useAuthShell } from "./auth-form-primitives.js";
export type {
  LoginRouteOptions,
  MfaSetupComponentProps,
  MfaVerifyComponentProps,
} from "./auth-gate.js";
export { createLoginRoute, makeAuthGate, makeSessionAuthGate } from "./auth-gate.js";
export type {
  EmailPasswordClientFeature,
  EmailPasswordClientOptions,
} from "./client-plugin.js";
export { emailPasswordClient } from "./client-plugin.js";
export type { ConfirmAccountUnlockScreenProps } from "./confirm-account-unlock-screen.js";
export { ConfirmAccountUnlockScreen } from "./confirm-account-unlock-screen.js";
export type { DefaultTopbarActionsProps } from "./default-topbar-actions.js";
export { DefaultTopbarActions } from "./default-topbar-actions.js";
export type { ForgotPasswordScreenProps } from "./forgot-password-screen.js";
export { ForgotPasswordScreen } from "./forgot-password-screen.js";
export type { InviteAcceptScreenProps } from "./invite-accept-screen.js";
export { InviteAcceptScreen } from "./invite-accept-screen.js";
export type { AuthLegalLink, LoginScreenProps } from "./login-screen.js";
export { LoginScreen } from "./login-screen.js";
export type { RequestAccountUnlockScreenProps } from "./request-account-unlock-screen.js";
export { RequestAccountUnlockScreen } from "./request-account-unlock-screen.js";
export type { ResetPasswordScreenProps } from "./reset-password-screen.js";
export { ResetPasswordScreen } from "./reset-password-screen.js";
export type {
  SessionApi,
  SessionBootstrapFailure,
  SessionState,
  SessionStatus,
} from "./session.js";
export { hasLikelyAuthSession, SessionContext, SessionProvider, useSession } from "./session.js";
export type { SessionBootstrapErrorScreenProps } from "./session-bootstrap-error.js";
export { retryDelayMs, SessionBootstrapErrorScreen } from "./session-bootstrap-error.js";
export type { SignupCompleteScreenProps } from "./signup-complete-screen.js";
export { SignupCompleteScreen } from "./signup-complete-screen.js";
export type { SignupScreenProps } from "./signup-screen.js";
export { SignupScreen } from "./signup-screen.js";
export type { TenantMenuItemsProps } from "./tenant-menu-items.js";
export { TenantMenuItems } from "./tenant-menu-items.js";
export type { TenantSwitcherProps } from "./tenant-switcher.js";
export { TenantSwitcher } from "./tenant-switcher.js";
export type { ShellUser } from "./use-shell-user.js";
export { useShellUser } from "./use-shell-user.js";
export type { UserMenuProps } from "./user-menu.js";
export { UserMenu } from "./user-menu.js";
export type { VerifyEmailScreenProps } from "./verify-email-screen.js";
export { VerifyEmailScreen } from "./verify-email-screen.js";
