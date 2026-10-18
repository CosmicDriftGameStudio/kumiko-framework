import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { composeEnvSchema, KumikoBootError, parseEnv } from "@cosmicdrift/kumiko-framework/env";
import { createAuthEmailPasswordFeature } from "../auth-email-password/index.ts";
import {
  authMfaEnvSchema,
  bindMfaTokenSecretsFromFeature,
  createAuthMfaFeature,
  mfaStatusCheckerFromFeature,
  mfaTokenSecretsEnvSchema,
  resolveMfaTokenSecrets,
  resolveMfaTokenSecretsFromEnv,
} from "../auth-mfa/index.ts";
import { smtpEnvSchema } from "../channel-email/index.ts";
import { createCryptoShreddingFeature, kmsEnvSchema } from "../crypto-shredding/index.ts";
import {
  createFileProviderS3Feature,
  createS3EnvSchema,
  s3EnvSchema,
} from "../file-provider-s3/index.ts";
import { buildInfoEnvSchema, demoAdminEnvSchema } from "../foundation-shared/index.ts";
import { createSecretsFeature } from "../secrets/index.ts";
import {
  createSubscriptionStripeFeature,
  stripeEnvSchema,
  subscriptionStripeEnvSchema,
} from "../subscription-stripe/index.ts";

type IsExactly<TActual, TExpected> = [TActual] extends [TExpected]
  ? [TExpected] extends [TActual]
    ? true
    : false
  : false;

function assertType<TCondition extends true>(_proof?: TCondition): void {}

function invalidNames(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (err) {
    if (err instanceof KumikoBootError) return err.errors.map((e) => `${e.name}:${e.kind}`);
    throw err;
  }
  throw new Error("expected a KumikoBootError");
}

const base64Key = randomBytes(32).toString("base64");
const longSecret = "x".repeat(32);

describe("kmsEnvSchema", () => {
  it("accepts an empty env and a full key set", () => {
    expect(parseEnv(kmsEnvSchema, {})).toEqual({});
    const parsed = parseEnv(kmsEnvSchema, {
      PLATFORM_KEK: base64Key,
      SUBJECT_KEYS_DATABASE_URL: "postgres://localhost/keys",
      KUMIKO_BLIND_INDEX_KEY: base64Key,
      PLATFORM_KEK_VERSION: "2",
    });
    expect(parsed.PLATFORM_KEK_VERSION).toBe("2");
  });

  it("rejects a non-numeric KEK generation", () => {
    expect(invalidNames(() => parseEnv(kmsEnvSchema, { PLATFORM_KEK_VERSION: "two" }))).toEqual([
      "PLATFORM_KEK_VERSION:invalid",
    ]);
  });

  it("is registered by createCryptoShreddingFeature", () => {
    expect(createCryptoShreddingFeature().envSchema).toBe(kmsEnvSchema);
  });
});

describe("smtpEnvSchema", () => {
  it("accepts an unset transport and a full one", () => {
    expect(parseEnv(smtpEnvSchema, {})).toEqual({});
    const parsed = parseEnv(smtpEnvSchema, {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
    });
    expect(parsed.SMTP_PORT).toBe("465");
  });

  it("rejects a non-numeric port and a non-boolean SMTP_SECURE", () => {
    expect(
      invalidNames(() => parseEnv(smtpEnvSchema, { SMTP_PORT: "smtp", SMTP_SECURE: "yes" })),
    ).toEqual(["SMTP_PORT:invalid", "SMTP_SECURE:invalid"]);
  });
});

describe("s3EnvSchema", () => {
  it("accepts https and loopback http endpoints and treats a blank endpoint as unset", () => {
    expect(parseEnv(s3EnvSchema, { S3_ENDPOINT: "https://fsn1.example.com" }).S3_ENDPOINT).toBe(
      "https://fsn1.example.com",
    );
    expect(parseEnv(s3EnvSchema, { S3_ENDPOINT: "http://localhost:9000" }).S3_ENDPOINT).toBe(
      "http://localhost:9000",
    );
    expect(parseEnv(s3EnvSchema, { S3_ENDPOINT: "" }).S3_ENDPOINT).toBeUndefined();
  });

  it("rejects plain http to a remote host in production and a non-boolean path-style flag", () => {
    const originalNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      expect(
        invalidNames(() =>
          parseEnv(s3EnvSchema, {
            S3_ENDPOINT: "http://s3.example.com",
            S3_FORCE_PATH_STYLE: "1",
          }),
        ),
      ).toEqual(["S3_ENDPOINT:invalid", "S3_FORCE_PATH_STYLE:invalid"]);
    } finally {
      if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalNodeEnv;
    }
  });

  it("builds a prefixed block with typed keys", () => {
    const releasesSchema = createS3EnvSchema({ prefix: "RELEASES_S3_" });
    const parsed = parseEnv(releasesSchema, { RELEASES_S3_BUCKET: "releases" });
    assertType<IsExactly<typeof parsed.RELEASES_S3_BUCKET, string | undefined>>();
    expect(Object.keys(releasesSchema.shape).sort()).toEqual([
      "RELEASES_S3_ACCESS_KEY",
      "RELEASES_S3_BUCKET",
      "RELEASES_S3_ENDPOINT",
      "RELEASES_S3_FORCE_PATH_STYLE",
      "RELEASES_S3_REGION",
      "RELEASES_S3_SECRET_KEY",
    ]);
  });

  it("is registered by the env-backed S3 provider only", () => {
    expect(createFileProviderS3Feature({ fromEnv: true }).envSchema).toBe(s3EnvSchema);
  });
});

describe("stripeEnvSchema", () => {
  it("adds one optional price slot per listed price next to the bridge keys", () => {
    const schema = stripeEnvSchema({ prices: ["PRO", "TEAM"] });
    const parsed = parseEnv(schema, { STRIPE_PRICE_PRO: "price_123" });
    assertType<IsExactly<typeof parsed.STRIPE_PRICE_TEAM, string | undefined>>();
    expect(parsed.STRIPE_PRICE_PRO).toBe("price_123");
    expect(schema.shape.STRIPE_API_KEY).toBe(subscriptionStripeEnvSchema.shape.STRIPE_API_KEY);
  });

  it("rejects a price id without the price_ prefix", () => {
    expect(
      invalidNames(() =>
        parseEnv(stripeEnvSchema({ prices: ["PRO"] }), { STRIPE_PRICE_PRO: "prod_1" }),
      ),
    ).toEqual(["STRIPE_PRICE_PRO:invalid"]);
  });

  it("composes next to the mounted feature without a key clash", () => {
    const composed = composeEnvSchema({
      features: [createSubscriptionStripeFeature({ priceToTier: {} })],
      extend: stripeEnvSchema({ prices: ["PRO"] }),
    });
    expect(composed.sources["STRIPE_API_KEY"]).toBe("subscription-stripe");
    expect(composed.sources["STRIPE_PRICE_PRO"]).toBe("app");
  });
});

describe("buildInfoEnvSchema", () => {
  it("keeps both values optional", () => {
    expect(parseEnv(buildInfoEnvSchema, {})).toEqual({});
    expect(parseEnv(buildInfoEnvSchema, { BUILD_VERSION: "v1.2.3" }).BUILD_VERSION).toBe("v1.2.3");
  });

  it("rejects an empty version", () => {
    expect(invalidNames(() => parseEnv(buildInfoEnvSchema, { BUILD_VERSION: "" }))).toEqual([
      "BUILD_VERSION:invalid",
    ]);
  });
});

describe("demoAdminEnvSchema", () => {
  it("requires both seed logins and keeps passwords optional", () => {
    const parsed = parseEnv(demoAdminEnvSchema, {
      DEMO_ADMIN_EMAIL: "admin@example.com",
      DEMO_SYSADMIN_EMAIL: "root@example.com",
    });
    expect(parsed.DEMO_ADMIN_PASSWORD).toBeUndefined();
    expect(invalidNames(() => parseEnv(demoAdminEnvSchema, {}))).toEqual([
      "DEMO_ADMIN_EMAIL:missing",
      "DEMO_SYSADMIN_EMAIL:missing",
    ]);
  });

  it("rejects a short password, a malformed email and a non-uuid tenant id", () => {
    expect(
      invalidNames(() =>
        parseEnv(demoAdminEnvSchema, {
          DEMO_ADMIN_EMAIL: "admin",
          DEMO_ADMIN_PASSWORD: "short",
          DEMO_SYSADMIN_EMAIL: "root@example.com",
          DEMO_TENANT_ID: "demo",
        }),
      ),
    ).toEqual([
      "DEMO_ADMIN_EMAIL:invalid",
      "DEMO_ADMIN_PASSWORD:invalid",
      "DEMO_TENANT_ID:invalid",
    ]);
  });
});

describe("mfaTokenSecretsEnvSchema", () => {
  it("accepts unset overrides and long ones", () => {
    expect(parseEnv(mfaTokenSecretsEnvSchema, {})).toEqual({});
    expect(
      parseEnv(mfaTokenSecretsEnvSchema, { MFA_SETUP_TOKEN_SECRET: longSecret })
        .MFA_SETUP_TOKEN_SECRET,
    ).toBe(longSecret);
  });

  it("rejects an override shorter than 32 characters", () => {
    expect(
      invalidNames(() => parseEnv(mfaTokenSecretsEnvSchema, { MFA_CHALLENGE_TOKEN_SECRET: "x" })),
    ).toEqual(["MFA_CHALLENGE_TOKEN_SECRET:invalid"]);
  });

  it("resolves explicit option, then env, then derivation; blank counts as absent", () => {
    const derived = resolveMfaTokenSecrets(longSecret);
    const explicitSetup = "s".repeat(32);
    const envChallenge = "c".repeat(32);
    expect(
      resolveMfaTokenSecretsFromEnv(
        longSecret,
        { MFA_SETUP_TOKEN_SECRET: "e".repeat(32), MFA_CHALLENGE_TOKEN_SECRET: envChallenge },
        { setupTokenSecret: explicitSetup },
      ),
    ).toEqual({ setupTokenSecret: explicitSetup, challengeTokenSecret: envChallenge });
    expect(resolveMfaTokenSecretsFromEnv(longSecret, { MFA_SETUP_TOKEN_SECRET: " " }, {})).toEqual(
      derived,
    );
  });

  it("is part of the auth-mfa block next to the shared master-key slot", () => {
    const feature = createAuthMfaFeature({ issuer: "Kumiko Test" });
    expect(feature.envSchema).toBe(authMfaEnvSchema);
    expect(Object.keys(authMfaEnvSchema.shape)).toContain("KUMIKO_SECRETS_MASTER_KEY_V1");
  });

  it("exposes a binder for features mounted without explicit token secrets", () => {
    const feature = createAuthMfaFeature({ issuer: "Kumiko Test" });
    expect(mfaStatusCheckerFromFeature(feature)).toBeDefined();
    expect(bindMfaTokenSecretsFromFeature(feature)).toBeInstanceOf(Function);
  });
});

describe("typed compose with bundled features", () => {
  it("types the env of the mounted secrets and auth features", () => {
    const composed = composeEnvSchema({
      features: [createSecretsFeature(), createAuthEmailPasswordFeature()],
      extend: buildInfoEnvSchema,
    });
    const parsed = parseEnv(composed.schema, {
      KUMIKO_SECRETS_MASTER_KEY_V1: base64Key,
      JWT_SECRET: longSecret,
    });
    assertType<IsExactly<typeof parsed.JWT_SECRET, string>>();
    assertType<IsExactly<typeof parsed.BUILD_VERSION, string | undefined>>();
    expect(parsed.JWT_SECRET).toBe(longSecret);
  });
});
