// API-internal constants. Features should never need these —
// they register handlers, the framework handles routing.

export const Routes = {
  health: "/health",
  healthReady: "/health/ready",
  version: "/version",
  write: "/write",
  batch: "/batch",
  query: "/query",
  command: "/command",
  sse: "/sse",
  stream: "/stream",
  auth: "/auth",
  authLogin: "/auth/login",
  authMfaVerify: "/auth/mfa/verify",
  authLogout: "/auth/logout",
  authTenants: "/auth/tenants",
  authSwitchTenant: "/auth/switch-tenant",
  authRequestPasswordReset: "/auth/request-password-reset",
  authResetPassword: "/auth/reset-password",
  authRequestEmailVerification: "/auth/request-email-verification",
  authVerifyEmail: "/auth/verify-email",
  authRequestAccountUnlock: "/auth/request-account-unlock",
  authConfirmAccountUnlock: "/auth/confirm-account-unlock",
  authSignupRequest: "/auth/signup-request",
  authSignupConfirm: "/auth/signup-confirm",
  // Tenant-Invite (Magic-Link): 3 separate accept-Endpoints für klare
  // Branch-Separation. Plus invite-info als public-readable details
  // damit das Frontend "Du wirst eingeladen zu Tenant X als Role Y"
  // anzeigen kann bevor der User submitted.
  authInviteAccept: "/auth/invite-accept",
  authInviteAcceptWithLogin: "/auth/invite-accept-with-login",
  authInviteSignupComplete: "/auth/invite-signup-complete",
  authInviteInfo: "/auth/invite-info",
  files: "/files",
} as const;

// Routes that must be reachable WITHOUT a valid JWT.
// The auth middleware skips these paths.
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  `/api${Routes.authLogin}`,
  `/api${Routes.authMfaVerify}`,
  `/api${Routes.authRequestPasswordReset}`,
  `/api${Routes.authResetPassword}`,
  `/api${Routes.authRequestEmailVerification}`,
  `/api${Routes.authVerifyEmail}`,
  `/api${Routes.authRequestAccountUnlock}`,
  `/api${Routes.authConfirmAccountUnlock}`,
  `/api${Routes.authSignupRequest}`,
  `/api${Routes.authSignupConfirm}`,
  // invite-accept braucht JWT (logged-in User, Branch 1) — NICHT public.
  // invite-accept-with-login (Branch 2) und invite-signup-complete
  // (Branch 3) sind anonymous, brauchen public-skip.
  `/api${Routes.authInviteAcceptWithLogin}`,
  `/api${Routes.authInviteSignupComplete}`,
  `/api${Routes.authInviteInfo}`,
  `/api${Routes.health}`,
  `/api${Routes.healthReady}`,
  `/api${Routes.version}`,
]);

// Methods that can mutate server state. GET/HEAD/OPTIONS are safe under
// CORS + SameSite-cookie semantics and skip the CSRF / Origin guards entirely.
export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

// Tenant transports for unauthenticated callers on public endpoints. JWT
// users carry tenantId in the signed token; anonymous callers must declare
// the tenant out-of-band — header for SPA/mobile, cookie for browser-direct
// access. The middleware reads header first, then cookie, then falls back to
// `anonymousAccess.tenantResolver` and finally `anonymousAccess.defaultTenantId`.
export const TENANT_HEADER_NAME = "X-Tenant";
export const TENANT_COOKIE_NAME = "kumiko_tenant";

export type Route = (typeof Routes)[keyof typeof Routes];
