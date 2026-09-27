import { SCHEMA_ENV_DEFAULTS } from "./schema-env-defaults-values";

// Mirrors authEmailPasswordEnvSchema's JWT_SECRET.min(32) / jwt.ts's HS256
// floor: a too-short value from a stray .env is replaced, not kept, same as
// the app-local preloads this centralizes did before it.
const MIN_JWT_SECRET_LENGTH = 32;

function isTooShortJwtSecret(key: string, value: string | undefined): boolean {
  return key === "JWT_SECRET" && (!value || value.length < MIN_JWT_SECRET_LENGTH);
}

for (const [key, value] of Object.entries(SCHEMA_ENV_DEFAULTS)) {
  if (isTooShortJwtSecret(key, process.env[key])) {
    process.env[key] = value;
    continue;
  }
  process.env[key] ??= value;
}
