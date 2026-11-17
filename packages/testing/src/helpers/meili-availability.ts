import { SERVICE_ENV_DEFAULTS } from "../preload/service-env-defaults-values.ts";

const REQUIRE_MEILI_ENV = "REQUIRE_MEILI";

export type LiveMeiliConnection = { readonly url: string; readonly masterKey: string };

export function liveMeiliConnection(): LiveMeiliConnection {
  return {
    url: process.env["MEILI_URL"] ?? SERVICE_ENV_DEFAULTS.MEILI_URL,
    masterKey: process.env["MEILI_MASTER_KEY"] ?? SERVICE_ENV_DEFAULTS.MEILI_MASTER_KEY,
  };
}

// CI integration jobs set REQUIRE_MEILI=1 and start Meili; there a down Meili is a
// misconfigured job and must fail instead of silently skipping the live tests.
export async function meiliAvailable(): Promise<boolean> {
  const { url } = liveMeiliConnection();
  const reachable = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
    .then((response) => response.ok)
    .catch(() => false);
  if (!reachable && process.env[REQUIRE_MEILI_ENV] === "1") {
    throw new Error(
      `REQUIRE_MEILI=1 but Meilisearch is not reachable at ${url}; the integration job is misconfigured.`,
    );
  }
  return reachable;
}
