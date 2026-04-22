import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "samples/**/*.test.ts"],
    exclude: ["**/*.integration.ts"],
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
      include: ["packages/framework/src/**", "samples/*/src/**"],
    },
  },
  // Cap worker threads to keep Load Avg reasonable on high-core machines.
  // Default = ncpu (12 on this workstation), which saturated the box during
  // `kumiko check`. Unit tests are CPU-bound but short — 4 threads keeps
  // wall-time close to default while leaving headroom for IDE/Docker.
  // (Top-level in Vitest 4; `test.poolOptions` is deprecated.)
  poolOptions: {
    threads: { maxThreads: 4, minThreads: 1 },
  },
});
