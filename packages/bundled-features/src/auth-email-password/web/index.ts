// Public exports für die Browser-Seite des auth-email-password Features.
// Wird über den Sub-Path-Export `@kumiko/bundled-features/auth-email-
// password/web` konsumiert — die Server-Seite (defineFeature) lebt in
// `@kumiko/bundled-features/auth-email-password` und hat keine
// React-/DOM-Deps. Trennung bleibt sauber so wie renderer vs renderer-web.

export type { CurrentUserProfile, LoginFailure, LoginRequest, TenantSummary } from "./auth-client";
export { makeAuthGate } from "./auth-gate";
export type {
  EmailPasswordClientFeature,
  EmailPasswordClientOptions,
} from "./client-plugin";
export { emailPasswordClient } from "./client-plugin";
export type { LoginScreenProps } from "./login-screen";
export { LoginScreen } from "./login-screen";
export type { SessionApi, SessionState, SessionStatus } from "./session";
export { SessionContext, SessionProvider, useSession } from "./session";
export type { TenantSwitcherProps } from "./tenant-switcher";
export { TenantSwitcher } from "./tenant-switcher";
export { defaultTranslations } from "./translations";
export type { UserMenuProps } from "./user-menu";
export { UserMenu } from "./user-menu";
