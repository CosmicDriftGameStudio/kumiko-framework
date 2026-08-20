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
  authMfaPreauthEnableStart: "/auth/mfa/preauth-enable-start",
  authMfaPreauthConfirm: "/auth/mfa/preauth-confirm",
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
  // Tenant invite (magic link): 3 separate accept endpoints for clear
  // branch separation. Plus invite-info as public-readable details so
  // the frontend can show "You're invited to tenant X as role Y" before
  // the user submits.
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
  `/api${Routes.authMfaPreauthEnableStart}`,
  `/api${Routes.authMfaPreauthConfirm}`,
  `/api${Routes.authRequestPasswordReset}`,
  `/api${Routes.authResetPassword}`,
  `/api${Routes.authRequestEmailVerification}`,
  `/api${Routes.authVerifyEmail}`,
  `/api${Routes.authRequestAccountUnlock}`,
  `/api${Routes.authConfirmAccountUnlock}`,
  `/api${Routes.authSignupRequest}`,
  `/api${Routes.authSignupConfirm}`,
  // invite-accept requires a JWT (logged-in user, branch 1) — NOT public.
  // invite-accept-with-login (branch 2) and invite-signup-complete
  // (branch 3) are anonymous and need the public skip.
  `/api${Routes.authInviteAcceptWithLogin}`,
  `/api${Routes.authInviteSignupComplete}`,
  `/api${Routes.authInviteInfo}`,
  `/api${Routes.health}`,
  `/api${Routes.healthReady}`,
  `/api${Routes.version}`,
]);

// Every other route in `Routes` — explicit, so a route can never fall
// through to "public" by simply being absent from PUBLIC_API_PATHS. A
// completeness test checks every `Routes` entry against the union of this
// set and PUBLIC_API_PATHS, so a new route with neither entry fails CI
// instead of shipping open.
export const NON_PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  `/api${Routes.write}`,
  `/api${Routes.batch}`,
  `/api${Routes.query}`,
  `/api${Routes.command}`,
  `/api${Routes.sse}`,
  `/api${Routes.stream}`,
  // Namespace prefix used only for body-limit registration
  // (`/api/auth/*` in route-registrars.ts) — never dispatched as its own
  // route, so it carries no auth bypass either way. Classified non-public
  // to keep the completeness check total.
  `/api${Routes.auth}`,
  `/api${Routes.authLogout}`,
  `/api${Routes.authTenants}`,
  `/api${Routes.authSwitchTenant}`,
  // invite-accept requires a JWT (Branch 1, see PUBLIC_API_PATHS above).
  `/api${Routes.authInviteAccept}`,
  `/api${Routes.files}`,
]);

// Opt-out from the default request-body-size cap (registerBodyLimit applies
// it to all of /api/* by construction — a new route needs no entry here to
// be covered). Only routes with their own, deliberately different size
// contract belong on this list; forgetting an entry is safe (over-limited,
// not unlimited), so keep it as short as the actual exceptions.
export const BODY_LIMIT_OPT_OUT_PATHS: ReadonlySet<string> = new Set([
  // Multipart uploads validate size against `maxUploadSize`/field `maxSize`
  // (often >1 MiB) after Hono's multipart parse, not before — the generic
  // JSON cap would reject legitimate uploads before that check ever runs.
  `/api${Routes.files}`,
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

// Client-declared active UI locale (BCP-47). Read once per request in
// request-id-middleware.ts, before auth, so it reaches public routes
// (e.g. signup-request) too. Falls back to Accept-Language, then the app's
// boot-configured defaultLocale, when absent or malformed — see
// request-locale.ts and dispatch-shared.ts's ctx.locale resolution.
export const LOCALE_HEADER_NAME = "X-Locale";

export type Route = (typeof Routes)[keyof typeof Routes];
