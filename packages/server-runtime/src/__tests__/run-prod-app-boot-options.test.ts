// The declarative boot options resolve before any connection: misconfigurations
// abort the boot, and option-mounted features reach validateBoot and the
// registry. KUMIKO_DRY_RUN_ENV=boot exits before DB/Redis, so no infra is needed.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { type RunProdAppOptions, runProdApp } from "../run-prod-app.js";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture.js";

const probeFeature = makeProbeFeature({
  name: "prod-boot-options-probe",
  table: "prod_boot_options_probe",
});

const deliveryFeatures = () => [
  probeFeature,
  createConfigFeature(),
  createTenantFeature(),
  createDeliveryFeature(),
];

const BOOT_ENV = {
  DATABASE_URL: "postgres://boot:boot@127.0.0.1:1/boot_options",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "b".repeat(32),
  KUMIKO_DRY_RUN_ENV: "boot",
} as const;

async function bootValidate(
  extra: Partial<RunProdAppOptions>,
  envSource: Record<string, string> = BOOT_ENV,
): Promise<void> {
  const handle = await runProdApp({
    features: [probeFeature],
    envSchema: composeEnvSchema({ features: [] }),
    autoListen: false,
    migrations: false,
    envSource: { ...envSource },
    ...extra,
  });
  await handle.stop();
}

describe("runProdApp boot options", () => {
  withClearedBootEnv();
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  const bootSummary = (): string =>
    logSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .find((line: string) => line.includes("boot validation OK")) ?? "";

  test("mail mounts channel-email into the validated feature set", async () => {
    const plaintext = { kmsMode: { plaintextReason: "test: boot-options focus, not crypto" } };
    await bootValidate({ features: deliveryFeatures(), ...plaintext });
    const without = bootSummary();
    logSpy.mockClear();

    await bootValidate({
      features: deliveryFeatures(),
      mail: { transport: "inmemory" },
      ...plaintext,
    });

    const countOf = (line: string): number => Number(/\((\d+) features/.exec(line)?.[1]);
    expect(countOf(bootSummary())).toBe(countOf(without) + 1);
  });

  test('mail "smtp-env" without SMTP_HOST aborts the boot', async () => {
    await expect(
      bootValidate({
        features: deliveryFeatures(),
        mail: { transport: "smtp-env" },
      }),
    ).rejects.toThrow(/SMTP_HOST/);
  });

  test("billing without tier-engine aborts and names the missing features", async () => {
    await expect(
      bootValidate({ billing: { stripe: { priceToTier: {} }, defaultTier: "free" } }),
    ).rejects.toThrow(/createTierEngineFeature/);
  });

  test('kmsMode "required" without the KMS env aborts', async () => {
    await expect(bootValidate({ kmsMode: "required" })).rejects.toThrow(/kmsMode "required"/);
  });

  test('fileStorage "auto" in production without S3 aborts', async () => {
    await expect(
      bootValidate({ fileStorage: { provider: "auto" } }, { ...BOOT_ENV, NODE_ENV: "production" }),
    ).rejects.toThrow(/file-foundation/);
  });

  test("seed shortcuts without auth abort", async () => {
    await expect(bootValidate({ seeds: { sysadminFromEnv: true } })).rejects.toThrow(/need `auth`/);
  });
});
