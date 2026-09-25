import { SERVICE_ENV_DEFAULTS } from "./service-env-defaults-values";

for (const [key, value] of Object.entries(SERVICE_ENV_DEFAULTS)) {
  process.env[key] ??= value;
}
