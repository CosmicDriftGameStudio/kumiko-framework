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
    },
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "samples/*/src/**"],
    },
  },
});
