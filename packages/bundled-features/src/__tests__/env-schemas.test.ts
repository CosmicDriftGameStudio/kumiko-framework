import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { composeEnvSchema, KumikoBootError, parseEnv } from "@cosmicdrift/kumiko-framework/env";
import {
  authEmailPasswordEnvSchema,
  createAuthEmailPasswordFeature,
} from "../auth-email-password/index.ts";
import { createAuthMfaFeature } from "../auth-mfa/index.ts";
import { createSecretsFeature, secretsEnvSchema } from "../secrets/index.ts";
import {
  createSubscriptionMollieFeature,
  subscriptionMollieEnvSchema,
} from "../subscription-mollie/index.ts";
import {
  createSubscriptionPaddleFeature,
  paddleEnvSchema,
  subscriptionPaddleEnvSchema,
} from "../subscription-paddle/index.ts";
import {
  createSubscriptionStripeFeature,
  subscriptionStripeEnvSchema,
} from "../subscription-stripe/index.ts";

const validKek = randomBytes(32).toString("base64");

function authMfaFeatureForEnvTests() {
  return createAuthMfaFeature({
    setupTokenSecret: "env-test-mfa-setup-secret-at-least-32-bytes!!",
    issuer: "Kumiko Test",
    challengeTokenSecret: "env-test-mfa-challenge-secret-at-least-32-bytes!!",
  });
}

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

describe("subscriptionPaddleEnvSchema", () => {
  it("accepts the bridge values and mounts fine without them", () => {
    const env = parseEnv(subscriptionPaddleEnvSchema, {
      PADDLE_API_KEY: "paddle_key",
      PADDLE_WEBHOOK_SECRET: "pdl_ntfset_abc",
      PADDLE_TENANT_BINDING_KEY: "binding",
      PADDLE_CLIENT_TOKEN: "test_abc123",
    });
    expect(env.PADDLE_API_KEY).toBe("paddle_key");
    expect(env.PADDLE_CLIENT_TOKEN).toBe("test_abc123");
    expect(parseEnv(subscriptionPaddleEnvSchema, {}).PADDLE_WEBHOOK_SECRET).toBeUndefined();
  });

  it("rejects empty secrets and a client token without the test_/live_ prefix", () => {
    try {
      parseEnv(subscriptionPaddleEnvSchema, {
        PADDLE_API_KEY: "",
        PADDLE_WEBHOOK_SECRET: "",
        PADDLE_TENANT_BINDING_KEY: "",
        PADDLE_CLIENT_TOKEN: "abc",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(asBootError(err).errors.length).toBe(4);
    }
  });

  it("attaches the schema via r.envSchema() on the factory", () => {
    expect(createSubscriptionPaddleFeature().envSchema).toBe(subscriptionPaddleEnvSchema);
  });
});

describe("paddleEnvSchema", () => {
  it("adds one optional price slot per listed price next to the bridge keys", () => {
    const schema = paddleEnvSchema({ prices: ["PRO", "TEAM"] });
    const parsed = parseEnv(schema, { PADDLE_PRICE_PRO: "pri_01h8xce0p4q3s8x1y2z3a4b5c6" });
    expect(parsed.PADDLE_PRICE_PRO).toBe("pri_01h8xce0p4q3s8x1y2z3a4b5c6");
    expect(parsed.PADDLE_PRICE_TEAM).toBeUndefined();
    expect(schema.shape.PADDLE_API_KEY).toBe(subscriptionPaddleEnvSchema.shape.PADDLE_API_KEY);
    expect(schema.shape.PADDLE_WEBHOOK_SECRET).toBe(
      subscriptionPaddleEnvSchema.shape.PADDLE_WEBHOOK_SECRET,
    );
  });

  it("rejects a price id without the pri_ prefix", () => {
    try {
      parseEnv(paddleEnvSchema({ prices: ["PRO"] }), { PADDLE_PRICE_PRO: "pdt_1" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(asBootError(err).errors.map((e) => e.name)).toEqual(["PADDLE_PRICE_PRO"]);
    }
  });

  it("composes next to the mounted feature without a key clash", () => {
    const composed = composeEnvSchema({
      features: [createSubscriptionPaddleFeature()],
      extend: paddleEnvSchema({ prices: ["PRO"] }),
    });
    expect(composed.sources["PADDLE_API_KEY"]).toBe("subscription-paddle");
    expect(composed.sources["PADDLE_PRICE_PRO"]).toBe("app");
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
      "KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT",
      "MOLLIE_API_KEY",
      "STRIPE_API_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(sources["JWT_SECRET"]).toBe("auth-email-password");
    expect(sources["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe("secrets");
    expect(sources["STRIPE_API_KEY"]).toBe("subscription-stripe");
    expect(sources["MOLLIE_API_KEY"]).toBe("subscription-mollie");
  });

  it("auth-mfa alone declares the master-key slot it encrypts with", () => {
    const { schema, sources } = composeEnvSchema({
      features: [authMfaFeatureForEnvTests()],
    });
    expect(Object.keys(schema.shape)).toContain("KUMIKO_SECRETS_MASTER_KEY_V1");
    expect(Object.keys(schema.shape)).toContain("KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT");
    expect(sources["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe("auth-mfa");
  });

  it("auth-mfa and secrets share the master-key variable without a conflict", () => {
    const { sources } = composeEnvSchema({
      features: [createSecretsFeature(), authMfaFeatureForEnvTests()],
    });
    expect(sources["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe("secrets");
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
      // subscription-stripe-v2: STRIPE_API_KEY/STRIPE_WEBHOOK_SECRET are now
      // optional env→secrets bridge fallbacks, so there is NO missing-required
      // boot error; credentials come from secrets at runtime.
      expect(out).not.toContain("STRIPE_API_KEY");
      expect(out).not.toContain("STRIPE_WEBHOOK_SECRET");
    }
  });
});
