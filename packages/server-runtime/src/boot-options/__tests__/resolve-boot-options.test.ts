import { describe, expect, spyOn, test } from "bun:test";
import { SUBSCRIPTION_WEBHOOK_PATH } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createInMemoryTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { resolveBillingOption } from "../billing-option.ts";
import { resolveFileStorageOption } from "../file-storage-option.ts";
import { resolveMailOption } from "../mail-option.ts";
import { resolveBootOptionWiring } from "../resolve-boot-options.ts";

const S3_ENV = {
  S3_BUCKET: "bucket",
  S3_REGION: "eu-central",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
};

function stubFeature(name: string): FeatureDefinition {
  return defineFeature(name, () => {});
}

const noMountedFeatures = new Set<string>();

describe("mail option", () => {
  const dev = { isProduction: false, authMailFrom: undefined };

  test('"smtp-env" without SMTP_HOST aborts', () => {
    expect(() => resolveMailOption({ transport: "smtp-env" }, { ...dev, envSource: {} })).toThrow(
      /SMTP_HOST/,
    );
  });

  test('"smtp-env" with SMTP_USER but no SMTP_PASS aborts', () => {
    expect(() =>
      resolveMailOption(
        { transport: "smtp-env" },
        { ...dev, envSource: { SMTP_HOST: "smtp.example", SMTP_USER: "u" } },
      ),
    ).toThrow(/SMTP_USER and SMTP_PASS/);
  });

  test('"smtp-env" with SMTP_HOST mounts channel-email', () => {
    const { feature } = resolveMailOption(
      { transport: "smtp-env" },
      { ...dev, envSource: { SMTP_HOST: "smtp.example" } },
    );
    expect(feature.name).toBe("channel-email");
  });

  test('"inmemory" is refused in production', () => {
    expect(() =>
      resolveMailOption({ transport: "inmemory" }, { ...dev, isProduction: true, envSource: {} }),
    ).toThrow(/NODE_ENV=production/);
  });

  test("a transport object is used as is", () => {
    const transport = createInMemoryTransport();
    expect(resolveMailOption({ transport }, { ...dev, envSource: {} }).transport).toBe(transport);
  });
});

describe("fileStorage option", () => {
  const base = { mountedFeatureNames: noMountedFeatures };

  test('"auto" picks s3-env when the S3 env is complete', () => {
    const resolved = resolveFileStorageOption(
      { provider: "auto" },
      { ...base, isProduction: true, envSource: S3_ENV },
    );
    expect(resolved.provider).toBe("s3-env");
    expect(resolved.features.map((f) => f.name)).toEqual(["file-provider-s3-env"]);
    expect(resolved.envDefaults).toEqual({ FILE_STORAGE_PROVIDER: "s3-env" });
  });

  test('"auto" in production without S3 names the missing keys', () => {
    expect(() =>
      resolveFileStorageOption(
        { provider: "auto" },
        { ...base, isProduction: true, envSource: { S3_BUCKET: "b" } },
      ),
    ).toThrow(/S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY/);
  });

  test('"auto" outside production falls back to inmemory', () => {
    const resolved = resolveFileStorageOption(
      { provider: "auto" },
      { ...base, isProduction: false, envSource: {} },
    );
    expect(resolved.provider).toBe("inmemory");
    expect(resolved.features.map((f) => f.name)).toEqual(["file-provider-inmemory"]);
  });

  test('"s3-env" with an incomplete env aborts', () => {
    expect(() =>
      resolveFileStorageOption(
        { provider: "s3-env" },
        { ...base, isProduction: false, envSource: {} },
      ),
    ).toThrow(/S3_BUCKET/);
  });

  test("an explicit FILE_STORAGE_PROVIDER wins over the default", () => {
    const resolved = resolveFileStorageOption(
      { provider: "inmemory" },
      { ...base, isProduction: false, envSource: { FILE_STORAGE_PROVIDER: "s3-env" } },
    );
    expect(resolved.envDefaults).toEqual({});
  });

  test("providers mounts more, already mounted ones are skipped", () => {
    const resolved = resolveFileStorageOption(
      { provider: "s3-env", providers: ["inmemory"] },
      {
        mountedFeatureNames: new Set(["file-provider-inmemory"]),
        isProduction: false,
        envSource: S3_ENV,
      },
    );
    expect(resolved.features.map((f) => f.name)).toEqual(["file-provider-s3-env"]);
  });

  test("an additional inmemory provider is refused in production", () => {
    expect(() =>
      resolveFileStorageOption(
        { provider: "s3-env", providers: ["inmemory"] },
        { ...base, isProduction: true, envSource: S3_ENV },
      ),
    ).toThrow(/inmemory/);
  });

  test("an additional s3-env provider needs the S3 env", () => {
    expect(() =>
      resolveFileStorageOption(
        { provider: "inmemory", providers: ["s3-env"] },
        { ...base, isProduction: false, envSource: {} },
      ),
    ).toThrow(/S3_BUCKET/);
  });

  const resolveWithNamed = (names: readonly string[]) =>
    resolveFileStorageOption(
      {
        provider: "s3-env",
        providers: names.map((name) => ({ name, envPrefix: "REL_S3_", lazy: true })),
      },
      { mountedFeatureNames: noMountedFeatures, isProduction: true, envSource: S3_ENV },
    );

  test.each(["s3-env", "s3", "inmemory"])("a named provider called %s is refused", (name) => {
    expect(() => resolveWithNamed([name])).toThrow(/reserved/);
  });

  test("a named provider listed twice is refused", () => {
    expect(() => resolveWithNamed(["releases", "releases"])).toThrow(/listed twice/);
  });

  test("distinct named providers mount", () => {
    expect(resolveWithNamed(["releases", "archive"]).features.map((f) => f.name)).toEqual([
      "file-provider-s3-env",
      "file-provider-s3-env-releases",
      "file-provider-s3-env-archive",
    ]);
  });
});

describe("billing option", () => {
  const billing = { stripe: { priceToTier: { price_pro: "pro" } }, defaultTier: "free" };

  test("mounts subscription-stripe and the tier-sync webhook on the default path", () => {
    const resolved = resolveBillingOption(billing, {});
    expect(resolved.features.map((feature) => feature.name)).toEqual(["subscription-stripe"]);
    expect(resolved.route.path).toBe(SUBSCRIPTION_WEBHOOK_PATH);
    expect(resolved.route.method).toBe("POST");
  });

  test("paddle alone mounts subscription-paddle on the shared route", () => {
    const resolved = resolveBillingOption(
      { paddle: { priceToTier: { pri_pro: "pro" } }, defaultTier: "free" },
      {},
    );
    expect(resolved.features.map((feature) => feature.name)).toEqual(["subscription-paddle"]);
    expect(resolved.route.path).toBe(SUBSCRIPTION_WEBHOOK_PATH);
  });

  test("stripe and paddle together mount both providers on one route", () => {
    const resolved = resolveBillingOption(
      { ...billing, paddle: { priceToTier: { pri_pro: "pro" } } },
      {},
    );
    expect(resolved.features.map((feature) => feature.name)).toEqual([
      "subscription-stripe",
      "subscription-paddle",
    ]);
    expect(resolved.route.path).toBe(SUBSCRIPTION_WEBHOOK_PATH);
  });

  test("billing without any provider is refused", () => {
    expect(() => resolveBillingOption({ defaultTier: "free" }, {})).toThrow(/at least one/);
  });

  test("webhookPath moves the route", () => {
    const resolved = resolveBillingOption(
      { ...billing, stripe: { ...billing.stripe, webhookPath: "/api/billing/:providerName" } },
      {},
    );
    expect(resolved.route.path).toBe("/api/billing/:providerName");
  });

  test("a webhookPath without :providerName is refused", () => {
    expect(() =>
      resolveBillingOption(
        { ...billing, stripe: { ...billing.stripe, webhookPath: "/api/billing/stripe" } },
        {},
      ),
    ).toThrow(/:providerName/);
  });
});

describe("resolveBootOptionWiring feature checks", () => {
  test("billing without tier-engine names the missing billing features", async () => {
    await expect(
      resolveBootOptionWiring(
        {
          features: [stubFeature("billing-foundation")],
          billing: { stripe: { priceToTier: {} }, defaultTier: "free" },
        },
        {},
      ),
    ).rejects.toThrow(/tier-engine.*createTierEngineFeature/);
  });

  test("mail without delivery is refused", async () => {
    await expect(
      resolveBootOptionWiring({ features: [], mail: { transport: "inmemory" } }, {}),
    ).rejects.toThrow(/delivery/);
  });

  test("mail next to a mounted channel-email is refused", async () => {
    await expect(
      resolveBootOptionWiring(
        {
          features: [stubFeature("delivery"), stubFeature("channel-email")],
          mail: { transport: "inmemory" },
        },
        {},
      ),
    ).rejects.toThrow(/mounts channel-email itself/);
  });

  test("fileStorage without file-foundation is refused", async () => {
    await expect(
      resolveBootOptionWiring({ features: [], fileStorage: { provider: "inmemory" } }, {}),
    ).rejects.toThrow(/file-foundation/);
  });

  test("the removed effectiveFeatures option aborts instead of dropping the kill-switch", async () => {
    const removedOption = { effectiveFeatures: () => new Set<string>() };
    await expect(resolveBootOptionWiring({ features: [], ...removedOption }, {})).rejects.toThrow(
      /featureToggles: true/,
    );
  });

  test("feature-toggles mounted without the featureToggles option is refused", async () => {
    await expect(
      resolveBootOptionWiring({ features: [stubFeature("feature-toggles")] }, {}),
    ).rejects.toThrow(/featureToggles.*is not set/);
  });

  test("featureToggles next to a mounted feature-toggles is refused", async () => {
    await expect(
      resolveBootOptionWiring(
        { features: [stubFeature("feature-toggles")], featureToggles: true },
        {},
      ),
    ).rejects.toThrow(/mounts feature-toggles itself/);
  });

  test("no option set yields an empty wiring", async () => {
    const wiring = await resolveBootOptionWiring({ features: [] }, { NODE_ENV: "production" });
    expect(wiring.features).toEqual([]);
    expect(wiring.extraRoutes).toEqual([]);
    expect(wiring.envDefaults).toEqual({});
    expect(wiring.mailConfigured).toBe(false);
    expect(wiring.kms.kms).toBeUndefined();
  });

  test("demoMode adds the /demo-mode route", async () => {
    const wiring = await resolveBootOptionWiring(
      { features: [], demoMode: { readOnly: true } },
      {},
    );
    expect(wiring.extraRoutes.map((route) => route.path)).toEqual(["/demo-mode"]);
  });

  test("the array seed form passes through as custom seeds", async () => {
    const seed = async (): Promise<void> => {};
    const wiring = await resolveBootOptionWiring({ features: [], seeds: [seed] }, {});
    expect(wiring.customSeeds).toEqual([seed]);
    expect(wiring.shortcutSeeds).toEqual([]);
  });
});

describe("resolveBootOptionWiring worker hint", () => {
  test("runSingleInstance:false with appOverrides warns to pass them to the worker", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await resolveBootOptionWiring(
        { features: [], runSingleInstance: false, appOverrides: { "a:config:b": 1 } },
        {},
      );
      expect(warn.mock.calls.flat().join("\n")).toContain("appOverrides");
    } finally {
      warn.mockRestore();
    }
  });
});
