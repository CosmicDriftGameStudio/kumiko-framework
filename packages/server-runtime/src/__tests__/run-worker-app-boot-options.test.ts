// runWorkerApp resolves the declarative boot options through the same functions as
// runProdApp, so a bad option aborts the worker before any DB/Redis connection opens.

import { describe, expect, spyOn, test } from "bun:test";
import { createTierEngineFeature } from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import * as z from "zod";
import { runWorkerApp } from "../run-worker-app.ts";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture.ts";

const probeFeature = makeProbeFeature({
  name: "worker-boot-options-probe",
  table: "worker_boot_options_probe",
});

const UNREACHABLE_ENV = {
  DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "worker-boot-options-secret-32-chars!!",
} as const;

describe("runWorkerApp boot options", () => {
  withClearedBootEnv();

  test("fileStorage without file-foundation aborts like runProdApp", async () => {
    await expect(
      runWorkerApp({
        features: [probeFeature],
        migrations: false,
        fileStorage: { provider: "inmemory" },
        allowPlaintextPii: "test: boot options focus, not PII crypto",
        envSource: { ...UNREACHABLE_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
      }),
    ).rejects.toThrow(/file-foundation/);
  });

  test("a stack that expects featureToggles aborts a worker without the option", async () => {
    const tierEngine = {
      ...createTierEngineFeature({
        defaultTier: "free",
        tierMap: { free: { features: [], caps: {} } },
      }),
      bootRequires: { stack: "composeSaasStack", options: ["featureToggles" as const] },
    };
    await expect(
      runWorkerApp({
        features: [probeFeature, tierEngine],
        migrations: false,
        allowPlaintextPii: "test: boot options focus, not PII crypto",
        envSource: { ...UNREACHABLE_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
      }),
    ).rejects.toThrow(/composeSaasStack needs the boot option `featureToggles`/);
  });

  test('kmsMode "required" without the KMS env aborts', async () => {
    await expect(
      runWorkerApp({
        features: [probeFeature],
        migrations: false,
        kmsMode: "required",
        envSource: { ...UNREACHABLE_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
      }),
    ).rejects.toThrow(/kmsMode "required"/);
  });

  test("mail smtp-env validates SMTP_HOST through the env schema", async () => {
    let reported: string | undefined;
    await expect(
      runWorkerApp({
        bootErrorReporter: (err) => {
          reported = err.format();
        },
        features: [probeFeature],
        migrations: false,
        mail: { transport: "smtp-env" },
        envSchema: composeEnvSchema({ features: [probeFeature] }),
        envSource: { ...UNREACHABLE_ENV },
      }),
    ).rejects.toThrow(/SMTP_HOST/);
    expect(reported).toContain("SMTP_HOST");
  });

  test("an env schema makes the worker answer KUMIKO_DRY_RUN_ENV=json without booting", async () => {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      const handle = await runWorkerApp({
        features: [probeFeature],
        migrations: false,
        envSchema: composeEnvSchema({
          features: [probeFeature],
          extend: z.object({ WORKER_DRY_RUN_PROBE: z.string() }),
        }),
        envSource: { ...UNREACHABLE_ENV, KUMIKO_DRY_RUN_ENV: "json" },
      });
      await handle.stop();
    } finally {
      log.mockRestore();
    }
    expect(lines.join("\n")).toContain("WORKER_DRY_RUN_PROBE");
  });
});
