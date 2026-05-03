// @runtime client
// Public exports für die Browser-Seite des auth-email-password Features.
// Wird über den Sub-Path-Export `@kumiko/bundled-features/auth-email-
// password/web` konsumiert — die Server-Seite (defineFeature) lebt in
// `@kumiko/bundled-features/auth-email-password` und hat keine
// React-/DOM-Deps. Trennung bleibt sauber so wie renderer vs renderer-web.

export { defaultTranslations } from "../i18n";
export type {
  CurrentUserProfile,
  LoginFailure,
  LoginRequest,
  ResetPasswordFailure,
  TenantSummary,
  VerifyEmailFailure,
} from "./auth-client";
export {
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "./auth-client";
export { makeAuthGate } from "./auth-gate";
export type {
  EmailPasswordClientFeature,
  EmailPasswordClientOptions,
} from "./client-plugin";
export { emailPasswordClient } from "./client-plugin";
export type { DefaultTopbarActionsProps } from "./default-topbar-actions";
export { DefaultTopbarActions } from "./default-topbar-actions";
export type { ForgotPasswordScreenProps } from "./forgot-password-screen";
export { ForgotPasswordScreen } from "./forgot-password-screen";
export type { LoginScreenProps } from "./login-screen";
export { LoginScreen } from "./login-screen";
export type { ResetPasswordScreenProps } from "./reset-password-screen";
export { ResetPasswordScreen } from "./reset-password-screen";
export type { SessionApi, SessionState, SessionStatus } from "./session";
export { SessionContext, SessionProvider, useSession } from "./session";
export type { TenantSwitcherProps } from "./tenant-switcher";
export { TenantSwitcher } from "./tenant-switcher";
export type { ShellUser } from "./use-shell-user";
export { useShellUser } from "./use-shell-user";
export type { UserMenuProps } from "./user-menu";
export { UserMenu } from "./user-menu";
export type { VerifyEmailScreenProps } from "./verify-email-screen";
export { VerifyEmailScreen } from "./verify-email-screen";
