// The declarative boot options resolve before any connection: misconfigurations
// abort the boot, and option-mounted features reach validateBoot and the
// registry. KUMIKO_DRY_RUN_ENV=boot exits before DB/Redis, so no infra is needed.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { composeEnvSchema, type KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import { type RunProdAppOptions, runProdApp } from "../run-prod-app.ts";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture.ts";

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

  test('the boot dry run checks the smtp-env block of mail "smtp-env" without the app composing it', async () => {
    await bootValidate({ features: deliveryFeatures(), mail: { transport: "smtp-env" } });

    const inventory =
      logSpy.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .find((line: string) => line.startsWith("Env check")) ?? "";
    const rowOf = (name: string): string =>
      inventory.split("\n").find((row: string) => row.trim().startsWith(`${name} `)) ?? "";
    expect(rowOf("SMTP_HOST")).toMatch(/runProdApp\.mail\s+required\s+.*missing/i);
    expect(rowOf("SMTP_PASS")).toMatch(/runProdApp\.mail\s+optional/);
    expect(inventory).toContain("1 required variable(s) missing");
    expect(bootSummary()).toBe("");
  });

  test("an invalid smtp-env value fails the boot dry run", async () => {
    const reported: KumikoBootError[] = [];
    await bootValidate(
      {
        features: deliveryFeatures(),
        mail: { transport: "smtp-env" },
        bootErrorReporter: (err) => {
          reported.push(err);
        },
      },
      { ...BOOT_ENV, SMTP_HOST: "smtp.example", SMTP_PORT: "not-a-port" },
    );
    expect(reported.map((err) => err.format()).join("\n")).toMatch(
      /SMTP_PORT \(runProdApp\.mail, invalid\)/,
    );
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
    const sysadminEnv = {
      ...BOOT_ENV,
      DEMO_SYSADMIN_EMAIL: "sysadmin@example.test",
      DEMO_SYSADMIN_PASSWORD: "sysadmin-password-123456",
    };
    await expect(bootValidate({ seeds: { sysadminFromEnv: true } }, sysadminEnv)).rejects.toThrow(
      /need `auth`/,
    );
  });
});
