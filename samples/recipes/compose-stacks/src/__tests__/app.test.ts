// KUMIKO_DRY_RUN_ENV=boot runs the full wiring check and stops before any
// DB/Redis connection, so the stack requirements are checked without infra.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { type RunProdAppOptions, runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import { appFeatures, bootOptions } from "../app";

const PRODUCTION_BOOT_ENV: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgres://recipe:recipe@127.0.0.1:1/recipe",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "r".repeat(32),
  KUMIKO_DRY_RUN_ENV: "boot",
  NODE_ENV: "production",
  PLATFORM_KEK: randomBytes(32).toString("base64"),
  SUBJECT_KEYS_DATABASE_URL: "postgres://kms:kms@127.0.0.1:1/subject_keys",
  KUMIKO_BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
};

async function bootValidate(options: Pick<RunProdAppOptions, "kmsMode" | "billing">) {
  const handle = await runProdApp({
    features: appFeatures(),
    envSchema: composeEnvSchema({ features: [] }),
    autoListen: false,
    migrations: false,
    envSource: { ...PRODUCTION_BOOT_ENV },
    ...options,
  });
  await handle.stop();
}

describe("compose stacks recipe", () => {
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

  test("the stacks with their boot options pass boot validation", async () => {
    await bootValidate(bootOptions());
    const lines = logSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines.some((line: string) => line.includes("boot validation OK"))).toBe(true);
  });

  test("a missing billing option names composeSaasStack and the option", async () => {
    const { billing: _billing, ...withoutBilling } = bootOptions();
    await expect(bootValidate(withoutBilling)).rejects.toThrow(
      "composeSaasStack needs the boot option `billing`",
    );
  });

  test("a missing KMS decision names every stack that needs it", async () => {
    const { kmsMode: _kmsMode, ...withoutKms } = bootOptions();
    const failure = bootValidate(withoutKms);
    await expect(failure).rejects.toThrow("composeSecurityStack needs the boot option `kmsMode`");
    await expect(failure).rejects.toThrow("composeGdprStack needs the boot option `kmsMode`");
  });
});
