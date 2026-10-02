import { SCHEMA_ENV_DEFAULTS } from "./schema-env-defaults-values";

// Mirrors authEmailPasswordEnvSchema's JWT_SECRET.min(32) / jwt.ts's HS256
// floor: a too-short value from a stray .env is replaced, not kept, same as
// the app-local preloads this centralizes did before it.
const MIN_JWT_SECRET_LENGTH = 32;

function isTooShortJwtSecret(key: string, value: string | undefined): boolean {
  return key === "JWT_SECRET" && value !== undefined && value.length < MIN_JWT_SECRET_LENGTH;
}

// An empty value counts as unset: `${{ secrets.X }}` in GitHub Actions yields "" for a missing secret.
for (const [key, value] of Object.entries(SCHEMA_ENV_DEFAULTS)) {
  const current = process.env[key];
  if (!current || isTooShortJwtSecret(key, current)) process.env[key] = value;
}
