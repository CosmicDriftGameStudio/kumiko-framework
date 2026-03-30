import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "features/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "features/*/src/**"],
    },
  },
});
