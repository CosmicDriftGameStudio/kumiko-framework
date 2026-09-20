export const KUMIKO_SECRETS_MASTER_KEY_V1 = "a3VtaWtvLXNjcmVlbnNob3QtZGV2LW1hc3Rlci0zMmI=";

export const PLAYWRIGHT_DEMO_ENV = {
  JWT_SECRET: "kumiko-e2e-jwt-secret-min-32-chars-ephemeral",
  KUMIKO_DEV_DB_NAME: "",
  KUMIKO_SECRETS_MASTER_KEY_V1,
  KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
} as const;

export const CSRF_COOKIE_NAME = "kumiko_csrf";
export const CSRF_HEADER_NAME = "X-CSRF-Token";

export const SEED_ENABLE_ENV = "KUMIKO_TEST_SEED";
export const SEED_TOKEN_ENV = "KUMIKO_TEST_SEED_TOKEN";
export const SEED_TOKEN_HEADER = "x-kumiko-test-seed";
export const E2E_WORKERS_ENV = "KUMIKO_E2E_WORKERS";

// Same literal as the framework's requireRealProviders(), which does not export it.
export const REAL_PROVIDERS_ENV = "KUMIKO_REAL_PROVIDERS";

export const SEED_ROUTE_PREFIX = "/__test";

export const SEED_ROUTES = {
  seedTenant: `${SEED_ROUTE_PREFIX}/seed-tenant`,
  seedUser: `${SEED_ROUTE_PREFIX}/seed-user`,
  inbox: `${SEED_ROUTE_PREFIX}/inbox`,
} as const;
