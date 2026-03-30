import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.integration.ts", "features/**/*.integration.ts"],
    reporters: ["dot"],
    passWithNoTests: true,
    testTimeout: 15000,
    env: {
      DATABASE_URL: "postgresql://kumiko:kumiko@localhost:15432/kumiko_dev",
      TEST_DATABASE_URL: "postgresql://kumiko:kumiko@localhost:15432/kumiko_test",
      REDIS_URL: "redis://localhost:16379",
      JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
    },
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "features/*/src/**"],
    },
  },
});
