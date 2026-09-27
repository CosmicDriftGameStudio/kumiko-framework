// KUMIKO_SECRETS_MASTER_KEY_V1 must base64-decode to exactly 32 bytes (AES-256 KEK).
export const SCHEMA_ENV_DEFAULTS = {
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  KUMIKO_SECRETS_MASTER_KEY_V1: "a3VtaWtvLXNjaGVtYS1lbnYtZGVmYXVsdC0zMmJ5dGU=",
  KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
} as const satisfies Record<string, string>;
