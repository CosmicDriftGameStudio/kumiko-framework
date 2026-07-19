// @runtime client
// Public exports für die Browser-Seite des auth-email-password Features.
// Wird über den Sub-Path-Export `@cosmicdrift/kumiko-bundled-features/auth-email-
// password/web` konsumiert — die Server-Seite (defineFeature) lebt in
// `@cosmicdrift/kumiko-bundled-features/auth-email-password` und hat keine
// React-/DOM-Deps. Trennung bleibt sauber so wie renderer vs renderer-web.

export { defaultTranslations, mergeTranslations } from "../i18n";
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
} from "./auth-client";
export {
  confirmSignup,
  requestEmailVerification,
  requestPasswordReset,
  requestSignup,
  resetPassword,
  verifyEmail,
} from "./auth-client";
export type { AuthCardProps, AuthShellRenderer } from "./auth-form-primitives";
export { AuthCard, AuthShellProvider, useAuthShell } from "./auth-form-primitives";
export type { LoginRouteOptions, MfaVerifyComponentProps } from "./auth-gate";
export { createLoginRoute, makeAuthGate, makeSessionAuthGate } from "./auth-gate";
export type {
  EmailPasswordClientFeature,
  EmailPasswordClientOptions,
} from "./client-plugin";
export { emailPasswordClient } from "./client-plugin";
export type { DefaultTopbarActionsProps } from "./default-topbar-actions";
export { DefaultTopbarActions } from "./default-topbar-actions";
export type { ForgotPasswordScreenProps } from "./forgot-password-screen";
export { ForgotPasswordScreen } from "./forgot-password-screen";
export type { InviteAcceptScreenProps } from "./invite-accept-screen";
export { InviteAcceptScreen } from "./invite-accept-screen";
export type { AuthLegalLink, LoginScreenProps } from "./login-screen";
export { LoginScreen } from "./login-screen";
export type { ResetPasswordScreenProps } from "./reset-password-screen";
export { ResetPasswordScreen } from "./reset-password-screen";
export type { SessionApi, SessionState, SessionStatus } from "./session";
export { hasLikelyAuthSession, SessionContext, SessionProvider, useSession } from "./session";
export type { SignupCompleteScreenProps } from "./signup-complete-screen";
export { SignupCompleteScreen } from "./signup-complete-screen";
export type { SignupScreenProps } from "./signup-screen";
export { SignupScreen } from "./signup-screen";
export type { TenantSwitcherProps } from "./tenant-switcher";
export { TenantSwitcher } from "./tenant-switcher";
export type { ShellUser } from "./use-shell-user";
export { useShellUser } from "./use-shell-user";
export type { UserMenuProps } from "./user-menu";
export { UserMenu } from "./user-menu";
export type { VerifyEmailScreenProps } from "./verify-email-screen";
export { VerifyEmailScreen } from "./verify-email-screen";
