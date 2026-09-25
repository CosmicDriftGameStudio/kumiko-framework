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

// Same literal as the framework's requireRealProviders()/isRealProviderRun(),
// duplicated because the Playwright config runs under Node and importing the
// framework's "./testing" barrel there would pull in its full Bun-toolchain
// dependency graph for a single string constant.
export const REAL_PROVIDERS_ENV = "KUMIKO_REAL_PROVIDERS";

export function isRealProviderRun(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[REAL_PROVIDERS_ENV] === "1";
}

// Same literal as kumiko-dev-server's createKumikoServer (STYLESHEET_WATCH_ENV),
// duplicated because the Playwright config runs under Node and can't import
// that Bun-toolchain-adjacent module.
export const STYLESHEET_WATCH_ENV = "KUMIKO_DEV_STYLESHEET_WATCH";

// Same literal as kumiko-dev-server's createKumikoServer (PROD_BUNDLES_ENV),
// duplicated for the same Node/Bun-toolchain reason.
export const PROD_BUNDLES_ENV = "KUMIKO_DEV_PROD_BUNDLES";

export const SEED_ROUTE_PREFIX = "/__test";

export const SEED_ROUTES = {
  seedTenant: `${SEED_ROUTE_PREFIX}/seed-tenant`,
  seedUser: `${SEED_ROUTE_PREFIX}/seed-user`,
  inbox: `${SEED_ROUTE_PREFIX}/inbox`,
} as const;
