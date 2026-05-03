export { AUTH_EMAIL_PASSWORD_FEATURE, AuthErrors, AuthHandlers } from "./constants";
// Default-HTML-Renderer für die Reset-Password + Verify-Email Mails.
// Apps wiren die `sendResetEmail` / `sendVerificationEmail` callbacks
// im framework-config — diese Renderer können als one-liner genutzt
// werden, oder die App schreibt einen eigenen Renderer für Branding.
export type {
  AuthMailLocale,
  RenderActivationEmailArgs,
  RenderedEmail,
  RenderResetPasswordEmailArgs,
  RenderVerifyEmailArgs,
} from "./email-templates";
export {
  renderActivationEmail,
  renderResetPasswordEmail,
  renderVerifyEmail,
} from "./email-templates";
export type {
  AccountLockoutOptions,
  AuthEmailPasswordOptions,
  EmailVerificationOptions,
  PasswordResetOptions,
} from "./feature";
export { createAuthEmailPasswordFeature } from "./feature";
export { hashPassword, verifyPassword } from "./password-hashing";
// Generic HMAC-signed single-purpose token helpers. Re-exported damit
// app-spezifische out-of-band-Flows (subscriber-confirm, magic-links,
// invite-tokens) denselben battle-tested signer/verifier nutzen können
// statt eigene HMAC-Logik zu duplizieren. Purpose-string diskriminiert
// Cross-Replay zwischen Flows.
export { signToken, TokenPurpose, type VerifyResult, verifyToken } from "./signed-token";
