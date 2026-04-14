// API-internal constants. Features should never need these —
// they register handlers, the framework handles routing.

export const Routes = {
  health: "/health",
  write: "/write",
  batch: "/batch",
  query: "/query",
  command: "/command",
  sse: "/sse",
  auth: "/auth",
  authTenants: "/auth/tenants",
  authSwitchTenant: "/auth/switch-tenant",
  files: "/files",
} as const;

export type Route = (typeof Routes)[keyof typeof Routes];
