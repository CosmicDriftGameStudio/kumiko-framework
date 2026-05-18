import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Sample-local config — same reasoning as pipeline-basics: aliases
// @cosmicdrift/* to worktree source so the M.2 step-engine + bundled
// step-dispatcher are visible. Worktree-wide vitest.integration.config.ts
// excludes this path.
const repoRoot = resolve(import.meta.dirname, "../../..");
const frameworkSrc = resolve(repoRoot, "packages/framework/src");
const bundledSrc = resolve(repoRoot, "packages/bundled-features/src");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@cosmicdrift\/kumiko-bundled-features\/([^/]+)\/(.+)$/,
        replacement: `${bundledSrc}/$1/$2`,
      },
      {
        find: /^@cosmicdrift\/kumiko-bundled-features\/([^/]+)$/,
        replacement: `${bundledSrc}/$1/index.ts`,
      },
      {
        find: /^@cosmicdrift\/kumiko-framework\/([^/]+)\/(.+)$/,
        replacement: `${frameworkSrc}/$1/$2`,
      },
      {
        find: /^@cosmicdrift\/kumiko-framework\/([^/]+)$/,
        replacement: `${frameworkSrc}/$1/index.ts`,
      },
      {
        find: /^@cosmicdrift\/kumiko-framework$/,
        replacement: `${frameworkSrc}/index.ts`,
      },
    ],
  },
  test: {
    name: "webhook-step-integration",
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.ts"],
    setupFiles: [resolve(repoRoot, "vitest.setup.ts")],
    reporters: ["dot"],
    passWithNoTests: true,
    testTimeout: 15000,
    env: {
      KUMIKO_INSTANCE_ID: "test-instance",
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
      LEGACY_DATABASE_URL: process.env["LEGACY_DATABASE_URL"] ?? "",
    },
  },
  poolOptions: {
    threads: { maxThreads: 3, minThreads: 1 },
  },
});
