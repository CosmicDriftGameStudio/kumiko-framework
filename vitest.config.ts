import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "samples/**/*.test.ts"],
    exclude: ["**/*.integration.ts"],
    reporters: ["dot"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "samples/*/src/**"],
    },
  },
});
