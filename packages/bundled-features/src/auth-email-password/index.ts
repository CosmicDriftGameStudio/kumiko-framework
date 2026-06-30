// Factory für die app-spezifische invite-Mail-Config (reset/verify/signup
// laufen über delivery). Baut das invite-Setup gegen mailSender + Render-
// Funktion — eliminiert Duplikate zwischen kumiko-studio, publicstatus und
// solon (jede App hatte identische sendInviteEmail-Wrapper kopiert).
export {
  type AuthMailerConfig,
  type AuthPaths,
  type CreateAuthMailerConfigArgs,
  createAuthMailerConfig,
  DEFAULT_AUTH_PATHS,
  makeAuthPaths,
} from "./auth-mailer";
export { AUTH_EMAIL_PASSWORD_FEATURE, AuthErrors, AuthHandlers } from "./constants";
// Renderers for the auth mails. The magic-link flows (reset, verify, signup-
// activation) emit structured AuthMailContent through delivery (ctx.notify);
// invite still returns RenderedEmail via the app-callback path.
export type {
  AuthMailContent,
  AuthMailLocale,
  AuthMailSection,
  RenderedEmail,
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
