export const SERVICE_ENV_DEFAULTS = {
  DATABASE_URL: "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev",
  TEST_DATABASE_URL: "postgresql://kumiko:kumiko@localhost:15432/kumiko_test",
  REDIS_URL: "redis://localhost:16379",
  MEILI_URL: "http://localhost:17700",
  MEILI_MASTER_KEY: "kumiko-dev-key",
  JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
  MINIO_ENDPOINT: "http://localhost:19000",
  MINIO_ACCESS_KEY: "kumiko",
  MINIO_SECRET_KEY: "kumiko-dev-secret",
  MINIO_BUCKET: "kumiko-dev",
  MINIO_REGION: "us-east-1",
  LEGACY_DATABASE_URL: "",
} as const satisfies Record<string, string>;
