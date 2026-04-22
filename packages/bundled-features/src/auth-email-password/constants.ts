export const AUTH_EMAIL_PASSWORD_FEATURE = "auth-email-password" as const;

// Qualified handler names. Non-CRUD handlers, no entity prefix.
export const AuthHandlers = {
  login: "auth-email-password:write:login",
  logout: "auth-email-password:write:logout",
  changePassword: "auth-email-password:write:change-password",
  requestPasswordReset: "auth-email-password:write:request-password-reset",
  resetPassword: "auth-email-password:write:reset-password",
  requestEmailVerification: "auth-email-password:write:request-email-verification",
  verifyEmail: "auth-email-password:write:verify-email",
} as const;

// Error codes — kept intentionally generic so clients can't distinguish
// "email doesn't exist" from "password wrong". Both surface as invalid_credentials.
// Soft-deleted users also collapse into invalid_credentials to avoid enumeration.
export const AuthErrors = {
  invalidCredentials: "invalid_credentials",
  noMembership: "no_membership",
  // Reset-flow: the route maps every reset-token verify failure (malformed,
  // bad signature, expired) to this single code so a probing client can't
  // learn whether a token was tampered with or just stale.
  invalidResetToken: "invalid_reset_token",
  resetNotConfigured: "password_reset_not_configured",
  // Verification-flow: mirrors the reset-token handling. The login path
  // uses `emailNotVerified` which IS a deliberate enumeration leak —
  // UX benefit (explicit "check your email") outweighs the marginal
  // signal ("this email exists in our system"). Signup already surfaces
  // that.
  invalidVerificationToken: "invalid_verification_token",
  verificationNotConfigured: "email_verification_not_configured",
  emailNotVerified: "email_not_verified",
  // Account-lockout: login refuses with this code when the user's streak of
  // failed attempts has crossed the configured threshold. The error detail
  // carries `retryAfterSeconds` so the UI can show a countdown. Returning a
  // distinct code (rather than hiding it inside invalid_credentials) is a
  // deliberate enumeration trade-off: the lockout event itself is already
  // observable to the attacker, and legit users benefit from a clear signal.
  accountLocked: "account_locked",
} as const;

// Account-lockout defaults — overridable via
// AuthEmailPasswordOptions.accountLockout on the feature. Defaults track the
// industry norm (NIST 800-63B) for password-only logins: a small streak
// threshold, a short cooldown.
export const AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS = 5;
export const AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES = 15;

export const AUTH_RESET_DEFAULT_TTL_MINUTES = 15;
// Verification tokens live longer by default because the user may not be
// at their computer the moment they sign up — 24h covers "verify after
// I've got home from work". The HMAC-signed token is still single-use
// because flipping emailVerified=true is an idempotent state change:
// replaying the same token re-sets the same flag.
export const AUTH_VERIFY_DEFAULT_TTL_MINUTES = 24 * 60;
