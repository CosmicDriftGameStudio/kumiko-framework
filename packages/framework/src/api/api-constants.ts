// API-internal constants. Features should never need these —
// they register handlers, the framework handles routing.

export const Routes = {
  health: "/health",
  healthReady: "/health/ready",
  write: "/write",
  batch: "/batch",
  query: "/query",
  command: "/command",
  sse: "/sse",
  auth: "/auth",
  authLogin: "/auth/login",
  authLogout: "/auth/logout",
  authTenants: "/auth/tenants",
  authSwitchTenant: "/auth/switch-tenant",
  authRequestPasswordReset: "/auth/request-password-reset",
  authResetPassword: "/auth/reset-password",
  authRequestEmailVerification: "/auth/request-email-verification",
  authVerifyEmail: "/auth/verify-email",
  files: "/files",
} as const;

// Routes that must be reachable WITHOUT a valid JWT.
// The auth middleware skips these paths.
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  `/api${Routes.authLogin}`,
  `/api${Routes.authRequestPasswordReset}`,
  `/api${Routes.authResetPassword}`,
  `/api${Routes.authRequestEmailVerification}`,
  `/api${Routes.authVerifyEmail}`,
  `/api${Routes.health}`,
  `/api${Routes.healthReady}`,
]);

export type Route = (typeof Routes)[keyof typeof Routes];
