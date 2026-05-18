import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Sample-local integration-test config for pipeline-basics.
//
// In this worktree, `node_modules/` is a symlink to the main framework's
// node_modules — every `@cosmicdrift/kumiko-framework` import normally
// resolves against the main framework's source, which doesn't yet have
// the M.1 Pipeline-Engine. To prove M.1 end-to-end, this sample's
// integration tests need the worktree's framework code, hence the
// resolve.alias block.
//
// Aliasing this sample-locally (rather than in the worktree-wide
// vitest.integration.config.ts) is intentional: a global alias would
// flip every sample-integration-test from "tests against the published
// framework" to "tests against the worktree", surfacing every latent
// API-divergence at once. Until M.1 + Q10 reach main, that divergence
// is real (e.g. cap-billing-demo expects the main framework's wiring) —
// keeping the alias scoped to this sample lets pre-existing
// sample-tests continue validating the published-library contract.
const repoRoot = resolve(import.meta.dirname, "../../..");
const frameworkSrc = resolve(repoRoot, "packages/framework/src");

export default defineConfig({
  resolve: {
    alias: [
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
    name: "pipeline-basics-integration",
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
