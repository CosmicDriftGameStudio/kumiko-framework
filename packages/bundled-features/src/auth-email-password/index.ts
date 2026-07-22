// Convention paths for the auth pages (reset/verify/signup/invite); apps build
// their magic-link appUrls from these. All mail now goes through delivery.

// Kept as a public re-export (not just internal call sites) — this feature's
// barrel is where consumers of the published package have always found
// hashPassword/verifyPassword; removing it is a breaking change that needs
// its own changeset + deliberate deprecation window, not a silent drop.
export { hashPassword, verifyPassword } from "../shared/password-hashing";
export { type AuthPaths, DEFAULT_AUTH_PATHS, makeAuthPaths } from "./auth-paths";
export { AUTH_EMAIL_PASSWORD_FEATURE, AuthErrors, AuthHandlers, AuthQueries } from "./constants";
// Renderers for the auth mails. All four magic-link flows (reset, verify,
// signup-activation, invite) emit structured AuthMailContent through delivery
// (ctx.notify).
export type {
  AuthMailContent,
  AuthMailLocale,
  AuthMailSection,
  RenderInviteEmailArgs,
  RenderTokenContentArgs,
} from "./email-templates";
export {
  renderActivationEmail,
  renderInviteEmail,
  renderResetPasswordEmail,
  renderUnlockAccountEmail,
  renderVerifyEmail,
} from "./email-templates";
export type {
  AccountLockoutOptions,
  AccountUnlockOptions,
  AuthEmailPasswordOptions,
  EmailVerificationOptions,
  InviteOptions,
  PasswordResetOptions,
  SignupOptions,
} from "./feature";
export { authEmailPasswordEnvSchema, createAuthEmailPasswordFeature } from "./feature";
export {
  AUTH_SELF_REGISTRATION_FEATURE,
  createAuthSelfRegistrationToggleFeature,
} from "./self-registration-toggle";
// Generic HMAC-signed single-purpose token helpers. Re-exported damit
// app-spezifische out-of-band-Flows (subscriber-confirm, magic-links,
// invite-tokens) denselben battle-tested signer/verifier nutzen können
// statt eigene HMAC-Logik zu duplizieren. Purpose-string diskriminiert
// Cross-Replay zwischen Flows.
export { signToken, TokenPurpose, type VerifyResult, verifyToken } from "./signed-token";
