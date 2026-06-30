// Convention paths for the auth pages (reset/verify/signup/invite); apps build
// their magic-link appUrls from these. All mail now goes through delivery.
export { type AuthPaths, DEFAULT_AUTH_PATHS, makeAuthPaths } from "./auth-paths";
export { AUTH_EMAIL_PASSWORD_FEATURE, AuthErrors, AuthHandlers } from "./constants";
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
  renderVerifyEmail,
} from "./email-templates";
export type {
  AccountLockoutOptions,
  AuthEmailPasswordOptions,
  EmailVerificationOptions,
  InviteOptions,
  PasswordResetOptions,
  SignupOptions,
} from "./feature";
export { authEmailPasswordEnvSchema, createAuthEmailPasswordFeature } from "./feature";
export { hashPassword, verifyPassword } from "./password-hashing";
// Generic HMAC-signed single-purpose token helpers. Re-exported damit
// app-spezifische out-of-band-Flows (subscriber-confirm, magic-links,
// invite-tokens) denselben battle-tested signer/verifier nutzen können
// statt eigene HMAC-Logik zu duplizieren. Purpose-string diskriminiert
// Cross-Replay zwischen Flows.
export { signToken, TokenPurpose, type VerifyResult, verifyToken } from "./signed-token";
