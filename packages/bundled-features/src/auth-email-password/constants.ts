// @runtime client
// Pure string constants — no DB/Node builtins. Marked `@runtime client` so
// browser code (Members screen etc.) can import them too without the
// runtime-isolation guard complaining. Runtime may import "client" files
// (see RUNTIME_RULES), so server-side access (handlers, dispatcher) stays
// intact as well.
export const AUTH_EMAIL_PASSWORD_FEATURE = "auth-email-password" as const;

// Minimum length for reset/verify hmacSecret — mirrors the ≥32-char
// JWT_SECRET env check (HMAC-SHA256 key material).
export const MIN_HMAC_SECRET_LENGTH = 32;

// Qualified handler names. Non-CRUD handlers, no entity prefix.
export const AuthHandlers = {
  login: "auth-email-password:write:login",
  logout: "auth-email-password:write:logout",
  changePassword: "auth-email-password:write:change-password",
  requestPasswordReset: "auth-email-password:write:request-password-reset",
  resetPassword: "auth-email-password:write:reset-password",
  requestEmailVerification: "auth-email-password:write:request-email-verification",
  verifyEmail: "auth-email-password:write:verify-email",
  // Account-Unlock Magic-Link (fixes the lockout-DoS where the monotonic
  // failure-counter re-locks immediately after expiry, #1266). Mirrors
  // reset: request mints an HMAC token + mails it, confirm clears the
  // Redis lockout state.
  requestAccountUnlock: "auth-email-password:write:request-account-unlock",
  confirmAccountUnlock: "auth-email-password:write:confirm-account-unlock",
  // Magic-link self-signup (pre-activation-token pattern). Request mints an
  // opaque random token, stores it bidirectionally in Redis and sends an
  // activation email. Confirm redeems the token and creates
  // user + tenant + Admin membership atomically. emailVerified=true from
  // second 0 — clicking the mail link IS the proof.
  signupRequest: "auth-email-password:write:signup-request",
  signupConfirm: "auth-email-password:write:signup-confirm",
  // Tenant-invite magic-link (admin invites a user into an existing tenant).
  // Three separate accept endpoints for clear branch separation:
  //   inviteCreate: admin → POST email + role
  //   inviteAccept: logged-in user → POST token (membership-add)
  //   inviteAcceptWithLogin: anon user with existing email → POST token + email + password
  //   inviteSignupComplete: anon user with new email → POST token + password
  //   inviteCancel: admin cancels a pending invite
  inviteCreate: "auth-email-password:write:invite-create",
  // System-only variant (access.system) that may carry global roles — see
  // invite-create.write.ts. Dispatched in-process by runBootstrap.
  systemInviteCreate: "auth-email-password:write:system-invite-create",
  inviteAccept: "auth-email-password:write:invite-accept",
  inviteAcceptWithLogin: "auth-email-password:write:invite-accept-with-login",
  inviteSignupComplete: "auth-email-password:write:invite-signup-complete",
  inviteCancel: "auth-email-password:write:invite-cancel",
} as const;

// Qualified query names. Anonymous-readable status so the (unauthenticated)
// signup page can decide whether to show its own link/form.
export const AuthQueries = {
  signupRegistrationStatus: "auth-email-password:query:signup-registration-status",
  // Anonymous, read-only invite lookup for the invite-acceptance page —
  // see invite-info.query.ts. Does not consume the token.
  inviteInfo: "auth-email-password:query:invite-info",
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
  // Account-Unlock: mirrors the reset-token handling — every verify
  // failure (malformed/bad-signature/expired) collapses to this single
  // code so a probing client can't distinguish tampered from stale.
  invalidUnlockToken: "invalid_unlock_token",
  unlockNotConfigured: "account_unlock_not_configured",
  // Self-signup: all confirm failures (unknown token, already
  // consumed, expired) collapse onto this code — same
  // anti-enumeration trade-off as reset/verify.
  invalidSignupToken: "invalid_signup_token",
  signupNotConfigured: "signup_not_configured",
  // Self-signup: confirm rejects an already-registered email instead of
  // reusing the existing user (account takeover, #365). NO
  // anti-enumeration collapse like invalidSignupToken: whoever gets here
  // controls the inbox (has the magic link), so revealing "email exists"
  // is not new information.
  signupEmailAlreadyRegistered: "signup_email_already_registered",
  // Invite flow: all token failures collapse onto invalidInviteToken
  // (anti-enumeration). emailMismatch when the invitee tries to accept the
  // link with a different email than the one invited.
  invalidInviteToken: "invalid_invite_token",
  inviteEmailMismatch: "invite_email_mismatch",
  inviteAlreadyMember: "invite_already_member",
  // Account-lockout: login refuses with this code when the user's streak of
  // failed attempts has crossed the configured threshold. The error detail
  // carries `retryAfterSeconds` so the UI can show a countdown. Returning a
  // distinct code (rather than hiding it inside invalid_credentials) is a
  // deliberate enumeration trade-off: the lockout event itself is already
  // observable to the attacker, and legit users benefit from a clear signal.
  accountLocked: "account_locked",
  // S2.U6 (GDPR Art. 18) — account is in Restricted status. Login is
  // explicitly refused with its own code (not collapsed into
  // invalid_credentials) so the UI can say "account is currently paused,
  // click here to lift it". Enumeration leak accepted: restriction is
  // user-initiated, the user already knows their account is restricted.
  accountRestricted: "account_restricted",
  // Account is in DeletionRequested or Deleted status. Unlike
  // Restricted, this is not reversible via login → we collapse onto
  // invalid_credentials so the forget-path isn't enumerable via login
  // (a user who clicked "delete account" shouldn't see again that their
  // email address still exists in the DB).
} as const;

// Account-lockout defaults — overridable via
// AuthEmailPasswordOptions.accountLockout on the feature. Defaults track the
// industry norm (NIST 800-63B) for password-only logins: a small streak
// threshold, a short cooldown.
export const AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS = 5;
export const AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES = 15;

// Account-unlock token TTL — same as reset (15min): short-lived, the user
// clicks it right after hitting the lockout screen.
export const AUTH_UNLOCK_DEFAULT_TTL_MINUTES = 15;

export const AUTH_RESET_DEFAULT_TTL_MINUTES = 15;
// Verification tokens live longer by default because the user may not be
// at their computer the moment they sign up — 24h covers "verify after
// I've got home from work". The HMAC-signed token is still single-use
// because flipping emailVerified=true is an idempotent state change:
// replaying the same token re-sets the same flag.
export const AUTH_VERIFY_DEFAULT_TTL_MINUTES = 24 * 60;

// Self-signup: 24h default. Long enough that the user doesn't have to
// think "activate quickly" — a mail link that still works tomorrow morning
// is user-friendly. Shorter TTLs cause resend-spam because users forget.
export const AUTH_SIGNUP_DEFAULT_TTL_MINUTES = 24 * 60;

// Tenant invite: 7 days default. Industry standard (GitHub, Linear,
// Slack); invitees often need longer to respond than in self-signup,
// where the user's intent is fresh.
export const AUTH_INVITE_DEFAULT_TTL_MINUTES = 7 * 24 * 60;
