import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@cosmicdrift/kumiko-framework/engine": path.resolve(
        __dirname,
        "packages/framework/src/engine",
      ),
      "@cosmicdrift/kumiko-framework/db": path.resolve(
        __dirname,
        "packages/framework/src/db",
      ),
      "@cosmicdrift/kumiko-framework/pipeline": path.resolve(
        __dirname,
        "packages/framework/src/pipeline",
      ),
    },
  },
  test: {
    name: "unit",
    globals: true,
    environment: "node",
    include: [
      "packages/**/*.test.{ts,tsx}",
      "samples/**/*.test.{ts,tsx}",
      "scripts/**/*.test.ts",
    ],
    exclude: ["**/*.integration.ts", "**/*.e2e.ts"],
    setupFiles: ["./vitest.setup.ts"],
    reporters: ["dot"],
    passWithNoTests: true,
    env: {
      // Stable instanceId so the boot-warn about unpinned per-instance
      // cursors doesn't spam the unit-test suite (some unit tests import
      // createApp indirectly).
      KUMIKO_INSTANCE_ID: "test-instance",
    },
    coverage: {
      provider: "v8",
      include: ["packages/framework/src/**", "samples/*/*/src/**"],
    },
  },
  // Worker-Threads je nach Kontext. KUMIKO_CHECK=1 (gesetzt von
  // `kumiko check`) cranked auf 8 — dort soll die Box eh gesättigt sein
  // und Wall-Time zählt. Default 4: Vitest läuft auch interaktiv im
  // Watch-Mode, da soll IDE/Docker Headroom haben — der frühere Vorfall
  // war "12 Threads × bun-hot saturierten alles". 8 trifft die Mitte;
  // Box hat 12 Cores. (Top-level in Vitest 4; `test.poolOptions` ist
  // deprecated.)
  poolOptions: {
    threads: {
      maxThreads: process.env["KUMIKO_CHECK"] === "1" ? 8 : 4,
      minThreads: 1,
    },
  },
});
