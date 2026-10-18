// KUMIKO_DRY_RUN_ENV=boot runs the whole wiring check and stops before any
// DB/Redis connection, so the stack requirements are checked without infra.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { type RunProdAppOptions, runProdApp } from "@cosmicdrift/kumiko-server-runtime";
import {
  composeAuthStack,
  composeFileStack,
  composeGdprStack,
  composeIdentityStack,
  composeMailStack,
  composeOpsStack,
  composePagesStack,
  composeRendererStack,
  composeSaasStack,
  composeSecurityStack,
  composeUserDataRightsStack,
} from "../compose-stacks";

const BOOT_ENV: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgres://stack:stack@127.0.0.1:1/stack",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "s".repeat(32),
  KUMIKO_DRY_RUN_ENV: "boot",
  NODE_ENV: "production",
};

const TIERS = {
  defaultTier: "free",
  tierMap: { free: { features: [], caps: {} } },
} as const;

type BootOptionOverrides = Omit<RunProdAppOptions, "features" | "envSchema">;

async function bootValidate(
  features: readonly FeatureDefinition[],
  overrides: BootOptionOverrides = {},
): Promise<void> {
  const handle = await runProdApp({
    features: [...features],
    envSchema: composeEnvSchema({ features: [] }),
    autoListen: false,
    migrations: false,
    envSource: { ...BOOT_ENV },
    ...overrides,
  });
  await handle.stop();
}

// Later boot checks may still reject a lone stack (missing peers); only the
// stack requirement message is under test here.
async function stackRequirementError(
  features: readonly FeatureDefinition[],
  overrides: BootOptionOverrides = {},
): Promise<string | undefined> {
  try {
    await bootValidate(features, overrides);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("needs the boot option") ? message : undefined;
  }
}

describe("stack boot requirements", () => {
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

  const missingOptionCases: ReadonlyArray<{
    readonly stack: string;
    readonly option: string;
    readonly features: () => readonly FeatureDefinition[];
  }> = [
    {
      stack: "composeMailStack",
      option: "mail",
      features: () => composeMailStack({ transports: ["smtp"] }),
    },
    { stack: "composeFileStack", option: "fileStorage", features: () => composeFileStack() },
    { stack: "composeGdprStack", option: "kmsMode", features: () => composeGdprStack() },
    {
      stack: "composeUserDataRightsStack",
      option: "mail",
      features: () => composeUserDataRightsStack(),
    },
    { stack: "composeSecurityStack", option: "kmsMode", features: () => composeSecurityStack() },
    {
      stack: "composeSaasStack",
      option: "billing",
      features: () => composeSaasStack({ billing: "stripe", tiers: TIERS }),
    },
  ];

  for (const { stack, option, features } of missingOptionCases) {
    test(`${stack} without \`${option}\` names the stack and the option`, async () => {
      await expect(bootValidate(features())).rejects.toThrow(
        `${stack} needs the boot option \`${option}\``,
      );
    });
  }

  test("composeSecurityStack with rateLimit: false names the rateLimit option", async () => {
    await expect(
      bootValidate(composeSecurityStack(), { kms: new InMemoryKmsAdapter(), rateLimit: false }),
    ).rejects.toThrow("composeSecurityStack needs the boot option `rateLimit`");
  });

  test("composeGdprStack selfService also needs mail", async () => {
    await expect(
      bootValidate(composeGdprStack({ selfService: {} }), { kms: new InMemoryKmsAdapter() }),
    ).rejects.toThrow("composeGdprStack needs the boot option `mail`");
  });

  const stacksWithoutRequirements: ReadonlyArray<{
    readonly stack: string;
    readonly features: () => readonly FeatureDefinition[];
  }> = [
    { stack: "composeRendererStack", features: () => composeRendererStack() },
    { stack: "composePagesStack", features: () => composePagesStack() },
    { stack: "composeOpsStack", features: () => composeOpsStack() },
    { stack: "composeIdentityStack", features: () => composeIdentityStack() },
    { stack: "composeAuthStack", features: () => composeAuthStack() },
  ];

  for (const { stack, features } of stacksWithoutRequirements) {
    test(`${stack} needs no boot option`, async () => {
      expect(await stackRequirementError(features())).toBeUndefined();
    });
  }

  test("the low-level paths satisfy the requirements", async () => {
    const error = await stackRequirementError(
      [
        ...composeMailStack({ transports: ["inmemory"] }),
        createChannelEmailFeature({
          transport: createInMemoryTransport(),
          resolveEmail: async () => "unused@test.local",
        }),
        ...composeFileStack({ providers: ["inmemory"] }),
        ...composeGdprStack(),
      ],
      { kms: new InMemoryKmsAdapter() },
    );
    expect(error).toBeUndefined();
  });
});
