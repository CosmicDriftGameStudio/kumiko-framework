import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@cosmicdrift/kumiko-framework/engine": path.resolve(
        __dirname,
        "packages/framework/src/engine",
      ),
      "@cosmicdrift/kumiko-framework/bun-db": path.resolve(
        __dirname,
        "packages/framework/src/bun-db",
      ),
      "@cosmicdrift/kumiko-framework/db": path.resolve(
        __dirname,
        "packages/framework/src/db",
      ),
      "@cosmicdrift/kumiko-framework/event-store": path.resolve(
        __dirname,
        "packages/framework/src/event-store",
      ),
      "@cosmicdrift/kumiko-framework/stack": path.resolve(
        __dirname,
        "packages/framework/src/stack",
      ),
      "@cosmicdrift/kumiko-framework/errors": path.resolve(
        __dirname,
        "packages/framework/src/errors",
      ),
      "@cosmicdrift/kumiko-framework/env/dry-run": path.resolve(
        __dirname,
        "packages/framework/src/env/dry-run.ts",
      ),
      "@cosmicdrift/kumiko-framework/env": path.resolve(
        __dirname,
        "packages/framework/src/env",
      ),
    },
  },
  test: {
    name: "integration",
    globals: true,
    environment: "node",
    include: ["packages/**/*.integration.ts", "samples/**/*.integration.ts"],
    // pipeline-basics needs the worktree's framework source (M.1 step-
    // engine isn't in main yet). It ships its own vitest.config.ts with
    // a worktree-source alias — running it via the root config crashes
    // at import-time with `r.requires.projection is not a function`.
    // Exclude here, run locally via:
    //   cd samples/recipes/pipeline-basics && bunx vitest run
    // Once M.1 lands in main, this exclude can go away.
    exclude: ["samples/recipes/pipeline-basics/**", "samples/recipes/webhook-step/**"],
    setupFiles: ["./vitest.setup.ts"],
    reporters: ["dot"],
    passWithNoTests: true,
    testTimeout: 15000,
    env: {
      // Stable instanceId so the boot-warn about unpinned per-instance
      // cursors doesn't spam the test suite. Tests that care about
      // multi-instance behaviour (pipeline/__tests__/event-dispatcher-
      // multi-instance.integration.ts) pass their own instanceId explicitly
      // and ignore this default.
      KUMIKO_INSTANCE_ID: "test-instance",
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
      // Legacy BeamMyCar DB (caryo_copy). Tests die diese Quelle brauchen,
      // skippen automatisch wenn die Var nicht gesetzt ist.
      LEGACY_DATABASE_URL: process.env.LEGACY_DATABASE_URL ?? "",
    },
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "samples/*/*/src/**"],
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
