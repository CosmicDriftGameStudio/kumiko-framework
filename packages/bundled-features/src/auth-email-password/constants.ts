// @runtime client
// Pure string-Konstanten — keine DB/Node-builtins. Mit `@runtime client`
// markiert damit auch Browser-Code (Members-Screen etc.) sie importieren
// kann ohne dass die runtime-isolation-Guard schreit. Runtime darf
// "client"-Files importieren (siehe RUNTIME_RULES), also bleibt auch
// der server-side Zugriff (handlers, dispatcher) erhalten.
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
  // Magic-Link Self-Signup (Pre-Activation-Token-Pattern). request mintet
  // einen opaken Random-Token, speichert ihn bidirektional in Redis und
  // sendet eine Aktivierungs-Mail. confirm löst den Token ein und legt
  // user + tenant + Admin-Membership atomar an. emailVerified=true ab
  // Sekunde 0 — der Klick auf den Mail-Link IST der Beweis.
  signupRequest: "auth-email-password:write:signup-request",
  signupConfirm: "auth-email-password:write:signup-confirm",
  // Tenant-Invite Magic-Link (Admin lädt User in existing Tenant ein).
  // Drei separate accept-Endpoints für klare Branch-Separation:
  //   inviteCreate: Admin → POST email + role
  //   inviteAccept: logged-in User → POST token (membership-add)
  //   inviteAcceptWithLogin: anon User mit existing email → POST token + email + password
  //   inviteSignupComplete: anon User mit neuer email → POST token + password
  //   inviteCancel: Admin cancelt pending invite
  inviteCreate: "auth-email-password:write:invite-create",
  inviteAccept: "auth-email-password:write:invite-accept",
  inviteAcceptWithLogin: "auth-email-password:write:invite-accept-with-login",
  inviteSignupComplete: "auth-email-password:write:invite-signup-complete",
  inviteCancel: "auth-email-password:write:invite-cancel",
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
  // Self-Signup: alle confirm-Failures (unbekannter Token, schon
  // konsumiert, abgelaufen) collapsen auf diesen Code — gleicher
  // anti-enumeration-Trade-off wie reset/verify.
  invalidSignupToken: "invalid_signup_token",
  signupNotConfigured: "signup_not_configured",
  // Self-Signup: confirm lehnt eine bereits registrierte Email ab statt den
  // bestehenden User wiederzuverwenden (Account-Takeover, #365). KEIN
  // anti-enumeration-collapse wie invalidSignupToken: wer hier ankommt,
  // kontrolliert die Inbox (hat den Magic-Link), das Reveal "Email existiert"
  // ist also keine neue Info.
  signupEmailAlreadyRegistered: "signup_email_already_registered",
  // Invite-Flow: alle Token-Failures collapsen auf invalidInviteToken
  // (anti-enumeration). emailMismatch wenn der invitee versucht den
  // Link mit einer anderen Email zu accepten als die eingeladene.
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
  // S2.U6 (DSGVO Art. 18) — Account ist im Restricted-Status. Login wird
  // explicit verweigert mit eigenem Code (nicht zu invalid_credentials
  // collapsen) damit UI sagen kann "Account ist aktuell pausiert, hier
  // klicken zum Aufheben". Enumeration-leak akzeptiert: Restriction ist
  // user-initiiert, der User weiss dass sein Konto restricted ist.
  accountRestricted: "account_restricted",
  // Account ist im DeletionRequested- oder Deleted-Status. Anders als
  // Restricted ist das nicht reversibel via Login → wir collapsen auf
  // invalid_credentials damit Forget-Pfad nicht via Login enumerierbar
  // wird (User der "Konto loeschen" geklickt hat soll nicht erneut sehen
  // dass die Email-Adresse noch in der DB existiert).
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

// Self-Signup: 24h Default. Lang genug damit User nicht denken muss
// "schnell aktivieren" — ein Mail-Link der morgen früh noch geht ist
// User-Friendly. Kürzere TTLs werfen Resend-Spam weil User vergessen.
export const AUTH_SIGNUP_DEFAULT_TTL_MINUTES = 24 * 60;

// Tenant-Invite: 7 Tage Default. Industry-Standard (GitHub, Linear,
// Slack); invitees brauchen oft länger zum Reagieren als bei Self-
// Signup wo die User-Intention frisch ist.
export const AUTH_INVITE_DEFAULT_TTL_MINUTES = 7 * 24 * 60;
