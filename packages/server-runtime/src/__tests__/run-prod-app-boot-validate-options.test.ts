// runProdApp must hand validateBootOptions to validateBoot, same as
// runWorkerApp (run-worker-app-boot.test.ts). KUMIKO_DRY_RUN_ENV=boot exits
// after validateBoot and before any DB/Redis connection, so no infra is needed.

import { describe, expect, spyOn, test } from "bun:test";
import { runProdApp } from "../run-prod-app.js";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture.js";

const probeFeature = makeProbeFeature({
  name: "prod-validate-options-probe",
  table: "prod_validate_options_probe",
});

const BOOT_ENV = {
  DATABASE_URL: "[REDACTED:db_url]127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "x".repeat(32),
  KUMIKO_DRY_RUN_ENV: "boot",
} as const;

describe("runProdApp validateBootOptions", () => {
  withClearedBootEnv();

  test("reaches validateBoot: the opt-in unique-role warning fires only when passed", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const roleWarnings = (): string[] =>
      warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('Access role "anonymous"'));
    try {
      const withOption = await runProdApp({
        features: [probeFeature],
        autoListen: false,
        migrations: false,
        validateBootOptions: { warnOnUniqueAccessRoles: true },
        envSource: { ...BOOT_ENV },
      });
      await withOption.stop();
      expect(roleWarnings().length).toBeGreaterThan(0);

      warnSpy.mockClear();
      const withoutOption = await runProdApp({
        features: [probeFeature],
        autoListen: false,
        migrations: false,
        envSource: { ...BOOT_ENV },
      });
      await withoutOption.stop();
      expect(roleWarnings()).toEqual([]);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
