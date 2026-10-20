// Convention paths for the auth pages (reset/verify/signup/invite); apps build
// their magic-link appUrls from these. All mail now goes through delivery.

// Kept as a public re-export (not just internal call sites) — this feature's
// barrel is where consumers of the published package have always found
// hashPassword/verifyPassword; removing it is a breaking change that needs
// its own changeset + deliberate deprecation window, not a silent drop.
export { hashPassword, verifyPassword } from "../shared/password-hashing.ts";
export { type AuthPath, type AuthPaths, DEFAULT_AUTH_PATHS, makeAuthPaths } from "./auth-paths.ts";
export type {
  BootstrapConfigValue,
  BootstrapDeps,
  BootstrapInvite,
  BootstrapInviteOutcome,
  BootstrapPlan,
  BootstrapReport,
  BootstrapSeedDeps,
  BootstrapSystemAdmin,
  BootstrapTenant,
  BootstrapTenantOutcome,
} from "./bootstrap.ts";
export { BootstrapPlanError, BootstrapWriteError, bootstrapTenants } from "./bootstrap.ts";
export type { AuthMailLocale } from "./email-templates.ts";
export type {
  AccountLockoutOptions,
  AccountUnlockOptions,
  AuthEmailPasswordOptions,
  EmailVerificationOptions,
  InviteOptions,
  PasswordResetOptions,
  SignupOptions,
} from "./feature.ts";
export { authEmailPasswordEnvSchema, createAuthEmailPasswordFeature } from "./feature.ts";
export { AuthMailNotificationTypes } from "./mail-notifications.ts";
export {
  AUTH_SELF_REGISTRATION_FEATURE,
  createAuthSelfRegistrationToggleFeature,
} from "./self-registration-toggle.ts";
// Generic HMAC-signed single-purpose token helpers. Re-exported damit
// app-spezifische out-of-band-Flows (subscriber-confirm, magic-links,
// invite-tokens) denselben battle-tested signer/verifier nutzen können
// statt eigene HMAC-Logik zu duplizieren. Purpose-string diskriminiert
// Cross-Replay zwischen Flows.
export { signToken, TokenPurpose, type VerifyResult, verifyToken } from "./signed-token.ts";
export {
  type IssuedSignupActivation,
  type IssueSignupActivationArgs,
  issueSignupActivation,
  SIGNUP_ACTIVATION_NOTIFICATION_TYPE,
} from "./signup-activation.ts";
export {
  invalidateExistingSignupToken,
  normalizeEmail,
  SIGNUP_TOKEN_KEY_PREFIXES,
  storeSignupToken,
} from "./signup-token-store.ts";
export {
  AUTH_EMAIL_PASSWORD_FEATURE,
  AuthErrors,
  AuthHandlers,
  AuthQueries,
} from "./web/constants.ts";
