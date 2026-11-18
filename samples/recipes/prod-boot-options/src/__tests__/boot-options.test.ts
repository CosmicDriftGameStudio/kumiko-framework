// KUMIKO_DRY_RUN_ENV=boot validates the whole wiring and exits before any
// DB/Redis connection, so the recipe's options are checked without infra.

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
  SMTP_HOST: "smtp.recipe.example",
  PLATFORM_KEK: randomBytes(32).toString("base64"),
  SUBJECT_KEYS_DATABASE_URL: "postgres://kms:kms@127.0.0.1:1/subject_keys",
  KUMIKO_BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
  S3_BUCKET: "recipe",
  S3_REGION: "eu-central",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
  PREVIEW_LOGIN_KEY: "a".repeat(64),
};

function withoutKey(key: string): Record<string, string> {
  const { [key]: _dropped, ...rest } = PRODUCTION_BOOT_ENV;
  return rest;
}

async function bootValidate(
  envSource: Record<string, string>,
  bootErrorReporter?: RunProdAppOptions["bootErrorReporter"],
): Promise<void> {
  const features = appFeatures();
  const handle = await runProdApp({
    features,
    envSchema: composeEnvSchema({ features: [] }),
    autoListen: false,
    migrations: false,
    envSource,
    ...bootOptions(envSource),
    ...(bootErrorReporter !== undefined && { bootErrorReporter }),
  });
  await handle.stop();
}

describe("prod boot options recipe", () => {
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

  test("a complete production env passes boot validation", async () => {
    await bootValidate({ ...PRODUCTION_BOOT_ENV });
    const lines = logSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(lines.some((line: string) => line.includes("boot validation OK"))).toBe(true);
  });

  test("an incomplete S3 env aborts the production boot", async () => {
    await expect(bootValidate(withoutKey("S3_BUCKET"))).rejects.toThrow(/S3_BUCKET/);
  });

  test("the dry run reports a missing SMTP host from the mail option's env block", async () => {
    await bootValidate(withoutKey("SMTP_HOST"));
    const lines = logSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    const inventory = lines.find((line: string) => line.startsWith("Env check")) ?? "";
    expect(inventory).toMatch(/SMTP_HOST\s+runProdApp\.mail\s+required\s+.*missing/i);
    expect(lines.some((line: string) => line.includes("boot validation OK"))).toBe(false);
  });

  test("the dry run names a missing KMS trio as required under kmsMode required", async () => {
    const envSource = withoutKey("PLATFORM_KEK");
    delete envSource["SUBJECT_KEYS_DATABASE_URL"];
    delete envSource["KUMIKO_BLIND_INDEX_KEY"];
    await bootValidate(envSource);
    const lines = logSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    const inventory = lines.find((line: string) => line.startsWith("Env check")) ?? "";
    for (const name of ["PLATFORM_KEK", "SUBJECT_KEYS_DATABASE_URL", "KUMIKO_BLIND_INDEX_KEY"]) {
      expect(inventory).toMatch(
        new RegExp(`${name}\\s+runProdApp\\.kmsMode\\s+required\\s+missing`),
      );
    }
    expect(lines.some((line: string) => line.includes("boot validation OK"))).toBe(false);
  });

  test("a missing KMS trio aborts the boot under kmsMode required", async () => {
    const envSource = withoutKey("KUMIKO_DRY_RUN_ENV");
    delete envSource["PLATFORM_KEK"];
    delete envSource["SUBJECT_KEYS_DATABASE_URL"];
    delete envSource["KUMIKO_BLIND_INDEX_KEY"];
    const boot = bootValidate(envSource, () => {});
    await expect(boot).rejects.toThrow(/PLATFORM_KEK/);
    await expect(boot).rejects.toThrow(/SUBJECT_KEYS_DATABASE_URL/);
    await expect(boot).rejects.toThrow(/KUMIKO_BLIND_INDEX_KEY/);
  });
});

describe("prod boot options recipe: previewLogin", () => {
  test("a loginKey shorter than 32 characters aborts the boot", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        bootValidate({ ...PRODUCTION_BOOT_ENV, PREVIEW_LOGIN_KEY: "too-short" }),
      ).rejects.toThrow(/previewLogin\.loginKey/);
    } finally {
      logSpy.mockRestore();
    }
  });
});
