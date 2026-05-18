import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@cosmicdrift/kumiko-framework/engine": path.resolve(
        __dirname,
        "../../../packages/framework/src/engine",
      ),
      "@cosmicdrift/kumiko-framework/db": path.resolve(
        __dirname,
        "../../../packages/framework/src/db",
      ),
      "@cosmicdrift/kumiko-framework/pipeline": path.resolve(
        __dirname,
        "../../../packages/framework/src/pipeline",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: [],
  },
});
