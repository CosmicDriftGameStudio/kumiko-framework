import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "integration",
    globals: true,
    environment: "node",
    include: ["packages/**/*.integration.ts", "samples/**/*.integration.ts"],
    setupFiles: ["./vitest.setup.ts"],
    reporters: ["dot"],
    passWithNoTests: true,
    testTimeout: 15000,
    env: {
      DATABASE_URL: "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev",
      TEST_DATABASE_URL: "postgresql://kumiko:kumiko@localhost:15432/kumiko_test",
      REDIS_URL: "redis://localhost:16379",
      MEILI_URL: "http://localhost:17700",
      MEILI_MASTER_KEY: "kumiko-dev-key",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
      // Minio (S3-kompatibel) aus docker-compose. Mitstartet durch
      // `kumiko dev` — gleiches Muster wie Postgres/Redis/Meili, kein
      // Env-Gating. Fehlt der Container, schlaegt der Test deutlich fehl.
      MINIO_ENDPOINT: "http://localhost:19000",
      MINIO_ACCESS_KEY: "kumiko",
      MINIO_SECRET_KEY: "kumiko-dev-secret",
      MINIO_BUCKET: "kumiko-dev",
      MINIO_REGION: "us-east-1",
    },
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "samples/*/src/**"],
    },
  },
  // Integration tests are DB-I/O-bound (Postgres + Redis + Meilisearch).
  // More workers means more connection-pool contention + Docker container
  // pressure, not faster wall-time. 3 threads is enough to overlap waits
  // without pushing Load Avg into double-digit territory on 12-core boxes.
  // (Top-level in Vitest 4; `test.poolOptions` is deprecated.)
  poolOptions: {
    threads: { maxThreads: 3, minThreads: 1 },
  },
});
