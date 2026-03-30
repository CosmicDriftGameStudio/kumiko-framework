import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "features/**/*.test.ts"],
    reporters: ["dot"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "features/*/src/**"],
    },
  },
});
