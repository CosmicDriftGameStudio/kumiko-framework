// Factory für app-spezifische Auth-Mail-Configs. Baut passwordReset,
// emailVerification, signup und invite Setups gegen mailSender + Render-
// Funktionen — eliminiert Duplikate zwischen kumiko-studio, publicstatus
// und solon (jede App hatte identische send*Email-Wrapper kopiert).
export {
  type AuthMailerConfig,
  type AuthPaths,
  type CreateAuthMailerConfigArgs,
  createAuthMailerConfig,
  DEFAULT_AUTH_PATHS,
  makeAuthPaths,
} from "./auth-mailer";
export { AUTH_EMAIL_PASSWORD_FEATURE, AuthErrors, AuthHandlers } from "./constants";
// Default-HTML-Renderer für die Reset-Password + Verify-Email Mails.
// Reset + verify emit structured AuthMailContent through delivery (ctx.notify);
// activation + invite still return RenderedEmail via the app-callback path.
export type {
  AuthMailContent,
  AuthMailLocale,
  AuthMailSection,
  RenderActivationEmailArgs,
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
