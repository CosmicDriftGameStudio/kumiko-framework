import { readAppMeilisearchPort } from "./app-meilisearch-port";
import { SERVICE_ENV_DEFAULTS } from "./service-env-defaults-values";

const meilisearchPort =
  process.env["MEILI_URL"] === undefined ? await readAppMeilisearchPort(process.cwd()) : undefined;

const defaults: Record<string, string> = {
  ...SERVICE_ENV_DEFAULTS,
  ...(meilisearchPort === undefined ? {} : { MEILI_URL: `http://localhost:${meilisearchPort}` }),
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
