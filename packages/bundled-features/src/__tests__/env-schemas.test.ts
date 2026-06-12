import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { composeEnvSchema, KumikoBootError, parseEnv } from "@cosmicdrift/kumiko-framework/env";
import { authEmailPasswordEnvSchema, createAuthEmailPasswordFeature } from "../auth-email-password";
import { createSecretsFeature, secretsEnvSchema } from "../secrets";
import {
  createSubscriptionMollieFeature,
  subscriptionMollieEnvSchema,
} from "../subscription-mollie";
import {
  createSubscriptionStripeFeature,
  subscriptionStripeEnvSchema,
} from "../subscription-stripe";

const validKek = randomBytes(32).toString("base64");

function asBootError(err: unknown): KumikoBootError {
  if (!(err instanceof KumikoBootError)) {
    throw err instanceof Error ? err : new Error(String(err));
  }
  return err;
}

describe("secretsEnvSchema", () => {
  it("accepts a base64-32 KEK and defaults CURRENT_VERSION to '1'", () => {
    const env = parseEnv(secretsEnvSchema, {
      KUMIKO_SECRETS_MASTER_KEY_V1: validKek,
    });
    expect(env.KUMIKO_SECRETS_MASTER_KEY_V1).toBe(validKek);
    expect(env.KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION).toBe("1");
  });

  it("rejects a base64 value that decodes to !=32 bytes", () => {
    try {
      parseEnv(secretsEnvSchema, { KUMIKO_SECRETS_MASTER_KEY_V1: "dGVzdA==" });
      throw new Error("should have thrown");
    } catch (err) {
      const boot = asBootError(err);
      const v1 = boot.errors.find((e) => e.name === "KUMIKO_SECRETS_MASTER_KEY_V1");
      expect(v1?.kind).toBe("invalid");
      expect(v1?.message).toContain("32 bytes");
    }
  });

  it("rejects a non-numeric CURRENT_VERSION", () => {
    try {
      parseEnv(secretsEnvSchema, {
        KUMIKO_SECRETS_MASTER_KEY_V1: validKek,
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "two",
      });
      throw new Error("should have thrown");
    } catch (err) {
      const cur = asBootError(err).errors.find(
        (e) => e.name === "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
      );
      expect(cur?.kind).toBe("invalid");
    }
  });

  it("rejects CURRENT_VERSION '0' (V0 never exists, selector starts at V1)", () => {
    try {
      parseEnv(secretsEnvSchema, {
        KUMIKO_SECRETS_MASTER_KEY_V1: validKek,
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "0",
      });
      throw new Error("should have thrown");
    } catch (err) {
      const cur = asBootError(err).errors.find(
        (e) => e.name === "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
      );
      expect(cur?.kind).toBe("invalid");
    }
  });

  it("accepts CURRENT_VERSION '2' (positive version selector)", () => {
    const env = parseEnv(secretsEnvSchema, {
      KUMIKO_SECRETS_MASTER_KEY_V1: validKek,
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
    });
    expect(env.KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION).toBe("2");
  });

  it("attaches the schema via r.envSchema() on createSecretsFeature()", () => {
    const f = createSecretsFeature();
    expect(f.envSchema).toBe(secretsEnvSchema);
  });
});

describe("authEmailPasswordEnvSchema", () => {
  it("accepts JWT_SECRET ≥32 chars; JWT_ISSUER stays optional", () => {
    const env = parseEnv(authEmailPasswordEnvSchema, {
      JWT_SECRET: "x".repeat(32),
    });
    expect(env.JWT_SECRET.length).toBe(32);
    expect(env.JWT_ISSUER).toBeUndefined();
  });

  it("rejects a short JWT_SECRET", () => {
    try {
      parseEnv(authEmailPasswordEnvSchema, { JWT_SECRET: "short" });
      throw new Error("should have thrown");
    } catch (err) {
      const jwt = asBootError(err).errors.find((e) => e.name === "JWT_SECRET");
      expect(jwt?.kind).toBe("invalid");
    }
  });

  it("attaches the schema via r.envSchema() on createAuthEmailPasswordFeature()", () => {
    const f = createAuthEmailPasswordFeature();
    expect(f.envSchema).toBe(authEmailPasswordEnvSchema);
  });
});

describe("subscriptionStripeEnvSchema", () => {
  it("accepts non-empty webhookSecret + apiKey", () => {
    const env = parseEnv(subscriptionStripeEnvSchema, {
      STRIPE_WEBHOOK_SECRET: "whsec_abc",
      STRIPE_API_KEY: "sk_test_xyz",
    });
    expect(env.STRIPE_WEBHOOK_SECRET).toBe("whsec_abc");
    expect(env.STRIPE_API_KEY).toBe("sk_test_xyz");
  });

  it("rejects empty values", () => {
    try {
      parseEnv(subscriptionStripeEnvSchema, {
        STRIPE_WEBHOOK_SECRET: "",
        STRIPE_API_KEY: "",
      });
      throw new Error("should have thrown");
    } catch (err) {
      const boot = asBootError(err);
      expect(boot.errors.length).toBe(2);
    }
  });

  it("rejects a publishable key and a non-whsec webhook secret", () => {
    try {
      parseEnv(subscriptionStripeEnvSchema, {
        STRIPE_WEBHOOK_SECRET: "wrong_abc",
        STRIPE_API_KEY: "pk_live_xyz",
      });
      throw new Error("should have thrown");
    } catch (err) {
      const boot = asBootError(err);
      const api = boot.errors.find((e) => e.name === "STRIPE_API_KEY");
      const hook = boot.errors.find((e) => e.name === "STRIPE_WEBHOOK_SECRET");
      expect(api?.kind).toBe("invalid");
      expect(hook?.kind).toBe("invalid");
    }
  });

  it("attaches the schema via r.envSchema() on the factory", () => {
    const f = createSubscriptionStripeFeature({
      webhookSecret: "whsec_x",
      apiKey: "sk_test_y",
      priceToTier: {},
    });
    expect(f.envSchema).toBe(subscriptionStripeEnvSchema);
  });
});

describe("subscriptionMollieEnvSchema", () => {
  it("accepts test_ and live_ prefixes", () => {
    expect(parseEnv(subscriptionMollieEnvSchema, { MOLLIE_API_KEY: "test_abc" })).toBeDefined();
    expect(parseEnv(subscriptionMollieEnvSchema, { MOLLIE_API_KEY: "live_xyz" })).toBeDefined();
  });

  it("rejects an unprefixed key", () => {
    try {
      parseEnv(subscriptionMollieEnvSchema, { MOLLIE_API_KEY: "no-prefix" });
      throw new Error("should have thrown");
    } catch (err) {
      const k = asBootError(err).errors.find((e) => e.name === "MOLLIE_API_KEY");
      expect(k?.kind).toBe("invalid");
    }
  });

  it("attaches the schema via r.envSchema() on the factory", () => {
    const f = createSubscriptionMollieFeature({
      apiKey: "test_x",
      webhookUrl: "https://example.com/webhook",
      priceToTier: {},
      priceToConfig: {},
    });
    expect(f.envSchema).toBe(subscriptionMollieEnvSchema);
  });
});

describe("compose across all Phase-2 features", () => {
  it("merges all four schemas with correct source attribution", () => {
    const features = [
      createSecretsFeature(),
      createAuthEmailPasswordFeature(),
      createSubscriptionStripeFeature({
        webhookSecret: "whsec_x",
        apiKey: "sk_test_y",
        priceToTier: {},
      }),
      createSubscriptionMollieFeature({
        apiKey: "test_x",
        webhookUrl: "https://example.com",
        priceToTier: {},
        priceToConfig: {},
      }),
    ];
    const { schema, sources } = composeEnvSchema({ features });
    const keys = Object.keys(schema.shape).sort();
    expect(keys).toEqual([
      "JWT_ISSUER",
      "JWT_SECRET",
      "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
      "KUMIKO_SECRETS_MASTER_KEY_V1",
      "MOLLIE_API_KEY",
      "STRIPE_API_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(sources["JWT_SECRET"]).toBe("auth-email-password");
    expect(sources["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe("secrets");
    expect(sources["STRIPE_API_KEY"]).toBe("subscription-stripe");
    expect(sources["MOLLIE_API_KEY"]).toBe("subscription-mollie");
  });

  it("KumikoBootError.format() shows feature-source for missing feature-env-vars", () => {
    const features = [
      createSecretsFeature(),
      createAuthEmailPasswordFeature(),
      createSubscriptionStripeFeature({
        webhookSecret: "whsec_x",
        apiKey: "sk_test_y",
        priceToTier: {},
      }),
      createSubscriptionMollieFeature({
        apiKey: "test_x",
        webhookUrl: "https://example.com",
        priceToTier: {},
        priceToConfig: {},
      }),
    ];
    const composed = composeEnvSchema({ features });
    try {
      parseEnv(composed.schema, {}, { sources: composed.sources });
      throw new Error("should have thrown");
    } catch (err) {
      const out = asBootError(err).format();
      expect(out).toContain("✗ JWT_SECRET (auth-email-password, required, missing)");
      expect(out).toContain("✗ KUMIKO_SECRETS_MASTER_KEY_V1 (secrets, required, missing)");
      expect(out).toContain("✗ MOLLIE_API_KEY (subscription-mollie, required, missing)");
      // subscription-stripe-v2: STRIPE_API_KEY/STRIPE_WEBHOOK_SECRET sind
      // jetzt optionale env→secrets-Bridge-Fallbacks, also KEIN missing-
      // required-Boot-Fehler mehr — credentials kommen zur Laufzeit aus
      // secrets.
      expect(out).not.toContain("STRIPE_API_KEY");
      expect(out).not.toContain("STRIPE_WEBHOOK_SECRET");
    }
  });
});
