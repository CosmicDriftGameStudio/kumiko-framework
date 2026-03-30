import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.integration.ts", "features/**/*.integration.ts"],
    reporters: ["dot"],
    passWithNoTests: true,
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "features/*/src/**"],
    },
  },
});
