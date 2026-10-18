// KUMIKO_DRY_RUN_ENV=boot runs the whole wiring check and stops before any
// DB/Redis connection, so the stack requirements are checked without infra.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import { createDeliveryFeature } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
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

  const reportedBootValidationOk = (): boolean =>
    logSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes("boot validation OK"));

  // user and tenant carry PII, so the PII boot gate needs a KMS decision.
  const PII_KMS: BootOptionOverrides = {
    kms: new InMemoryKmsAdapter(),
    blindIndexKey: Buffer.alloc(32, 7).toString("base64"),
  };

  // A lone stack still needs its peers to pass the boot validator.
  const corePeers = (): readonly FeatureDefinition[] => [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
  ];

  const stacksWithoutRequirements: ReadonlyArray<{
    readonly stack: string;
    readonly features: () => readonly FeatureDefinition[];
  }> = [
    { stack: "composeRendererStack", features: () => [...corePeers(), ...composeRendererStack()] },
    {
      stack: "composePagesStack",
      features: () => [...corePeers(), createTemplateResolverFeature(), ...composePagesStack()],
    },
    { stack: "composeOpsStack", features: () => [...corePeers(), ...composeOpsStack()] },
    { stack: "composeIdentityStack", features: () => [...corePeers(), ...composeIdentityStack()] },
    { stack: "composeAuthStack", features: () => [...corePeers(), ...composeAuthStack()] },
  ];

  for (const { stack, features } of stacksWithoutRequirements) {
    test(`${stack} needs no boot option`, async () => {
      await expect(bootValidate(features(), PII_KMS)).resolves.toBeUndefined();
      expect(reportedBootValidationOk()).toBe(true);
    });
  }

  test("the low-level paths satisfy the requirements", async () => {
    await expect(
      bootValidate(
        [
          ...corePeers(),
          createDeliveryFeature(),
          ...composeMailStack({ transports: ["inmemory"] }),
          createChannelEmailFeature({
            transport: createInMemoryTransport(),
            resolveEmail: async () => "unused@test.local",
          }),
          ...composeFileStack({ providers: ["inmemory"] }),
          ...composeGdprStack(),
        ],
        PII_KMS,
      ),
    ).resolves.toBeUndefined();
    expect(reportedBootValidationOk()).toBe(true);
  });
});
