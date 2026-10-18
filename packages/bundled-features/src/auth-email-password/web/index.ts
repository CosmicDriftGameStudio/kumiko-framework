// @runtime client
// Public exports für die Browser-Seite des auth-email-password Features.
// Wird über den Sub-Path-Export `@cosmicdrift/kumiko-bundled-features/auth-email-
// password/web` konsumiert — die Server-Seite (defineFeature) lebt in
// `@cosmicdrift/kumiko-bundled-features/auth-email-password` und hat keine
// React-/DOM-Deps. Trennung bleibt sauber so wie renderer vs renderer-web.

export { defaultTranslations, mergeTranslations } from "../i18n.ts";
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
} from "./auth-client.ts";
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
} from "./auth-client.ts";
export type { AuthCardProps, AuthShellRenderer } from "./auth-form-primitives.tsx";
export { AuthCard, AuthShellProvider, useAuthShell } from "./auth-form-primitives.tsx";
export type {
  AuthGateOptions,
  LoginRouteOptions,
  MfaSetupComponentProps,
  MfaVerifyComponentProps,
  SessionAuthGateOptions,
} from "./auth-gate.tsx";
export { createLoginRoute, makeAuthGate, makeSessionAuthGate } from "./auth-gate.tsx";
export {
  buildLoginRedirectUrl,
  isSafeNextPath,
  NEXT_QUERY_PARAM,
  readNextFromSearch,
} from "./auth-redirect.ts";
export type {
  EmailPasswordClientFeature,
  EmailPasswordClientOptions,
} from "./client-plugin.ts";
export { emailPasswordClient } from "./client-plugin.ts";
export type { ConfirmAccountUnlockScreenProps } from "./confirm-account-unlock-screen.tsx";
export { ConfirmAccountUnlockScreen } from "./confirm-account-unlock-screen.tsx";
export type { DefaultTopbarActionsProps } from "./default-topbar-actions.tsx";
export { DefaultTopbarActions } from "./default-topbar-actions.tsx";
export type { ForgotPasswordScreenProps } from "./forgot-password-screen.tsx";
export { ForgotPasswordScreen } from "./forgot-password-screen.tsx";
export type { InviteAcceptScreenProps } from "./invite-accept-screen.tsx";
export { InviteAcceptScreen } from "./invite-accept-screen.tsx";
export type { AuthLegalLink, LoginScreenProps } from "./login-screen.tsx";
export { LoginScreen } from "./login-screen.tsx";
export type { RequestAccountUnlockScreenProps } from "./request-account-unlock-screen.tsx";
export { RequestAccountUnlockScreen } from "./request-account-unlock-screen.tsx";
export type { ResetPasswordScreenProps } from "./reset-password-screen.tsx";
export { ResetPasswordScreen } from "./reset-password-screen.tsx";
export type {
  SessionApi,
  SessionBootstrapFailure,
  SessionState,
  SessionStatus,
} from "./session.tsx";
export { hasLikelyAuthSession, SessionContext, SessionProvider, useSession } from "./session.tsx";
export type { SessionBootstrapErrorScreenProps } from "./session-bootstrap-error.tsx";
export { retryDelayMs, SessionBootstrapErrorScreen } from "./session-bootstrap-error.tsx";
export type { SignupCompleteScreenProps } from "./signup-complete-screen.tsx";
export { SignupCompleteScreen } from "./signup-complete-screen.tsx";
export type { SignupScreenProps } from "./signup-screen.tsx";
export { SignupScreen } from "./signup-screen.tsx";
export type { TenantMenuItemsProps } from "./tenant-menu-items.tsx";
export { TenantMenuItems } from "./tenant-menu-items.tsx";
export type { TenantSwitcherProps } from "./tenant-switcher.tsx";
export { TenantSwitcher } from "./tenant-switcher.tsx";
export type { ShellUser } from "./use-shell-user.ts";
export { useShellUser } from "./use-shell-user.ts";
export type { UserMenuProps } from "./user-menu.tsx";
export { UserMenu } from "./user-menu.tsx";
export type { VerifyEmailScreenProps } from "./verify-email-screen.tsx";
export { VerifyEmailScreen } from "./verify-email-screen.tsx";
