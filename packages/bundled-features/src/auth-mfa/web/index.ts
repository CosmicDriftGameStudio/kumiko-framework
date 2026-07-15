// @runtime client
// Public exports für die Browser-Seite des auth-mfa Features. Sub-Path-
// Export `@cosmicdrift/kumiko-bundled-features/auth-mfa/web` — Server-Seite
// (defineFeature) bleibt frei von React-/DOM-Deps, siehe auth-email-
// password/web/index.ts für die selbe Trennung.

export { defaultTranslations, mergeTranslations } from "../i18n";
export type { AuthMfaClientFeature, AuthMfaClientOptions } from "./client-plugin";
export { authMfaClient } from "./client-plugin";
export type { MfaVerifyResult } from "./mfa-client";
export { verifyMfaChallenge } from "./mfa-client";
export type { MfaEnableScreenProps } from "./mfa-enable-screen";
export { MfaEnableScreen } from "./mfa-enable-screen";
export type { MfaVerifyScreenProps } from "./mfa-verify-screen";
export { MfaVerifyScreen } from "./mfa-verify-screen";
