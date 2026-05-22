import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFeature } from "../../engine/define-feature";
import { camelCase, composeEnvSchema, KumikoBootError, parseEnv, pulumiConfigKey } from "../index";

describe("composeEnvSchema", () => {
  it("merges per-feature schemas and tags sources", () => {
    const secretsFeature = defineFeature("secrets", (r) => {
      r.envSchema(
        z.object({
          KUMIKO_SECRETS_MASTER_KEY_V1: z.string().describe("AES-256 KEK"),
        }),
      );
    });
    const authFeature = defineFeature("auth", (r) => {
      r.envSchema(
        z.object({
          JWT_SECRET: z.string().min(32).describe("Session JWT signing key"),
        }),
      );
    });

    const { schema, sources } = composeEnvSchema({
      features: [secretsFeature, authFeature],
      extend: z.object({
        STUDIO_ADMIN_EMAIL: z.email(),
      }),
    });

    expect(Object.keys(schema.shape).sort()).toEqual([
      "JWT_SECRET",
      "KUMIKO_SECRETS_MASTER_KEY_V1",
      "STUDIO_ADMIN_EMAIL",
    ]);
    expect(sources).toEqual({
      JWT_SECRET: "auth",
      KUMIKO_SECRETS_MASTER_KEY_V1: "secrets",
      STUDIO_ADMIN_EMAIL: "app",
    });
  });

  it("detects feature/feature env-var conflicts", () => {
    const a = defineFeature("feat-a", (r) => {
      r.envSchema(z.object({ JWT_SECRET: z.string() }));
    });
    const b = defineFeature("feat-b", (r) => {
      r.envSchema(z.object({ JWT_SECRET: z.string() }));
    });

    expect(() => composeEnvSchema({ features: [a, b] })).toThrow(KumikoBootError);
  });

  it("detects feature/app env-var conflicts", () => {
    const a = defineFeature("feat-a", (r) => {
      r.envSchema(z.object({ DATABASE_URL: z.string() }));
    });
    expect(() =>
      composeEnvSchema({
        features: [a],
        extend: z.object({ DATABASE_URL: z.string() }),
      }),
    ).toThrow(KumikoBootError);
  });

  it("wraps optionalFeatures' vars as .optional()", () => {
    const smtp = defineFeature("channel-email-smtp", (r) => {
      r.envSchema(z.object({ SMTP_HOST: z.string() }));
    });
    const { schema } = composeEnvSchema({
      features: [smtp],
      optionalFeatures: ["channel-email-smtp"],
    });
    // Parsing without SMTP_HOST should now succeed.
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("double-wrapping an already-optional field stays parseable", () => {
    // Edge case: feature declares the field optional AND the app marks
    // the whole feature as optionalFeatures. composeEnvSchema wraps again.
    // Zod v4 treats .optional().optional() as idempotent.
    const smtp = defineFeature("channel-email-smtp", (r) => {
      r.envSchema(z.object({ SMTP_HOST: z.string().optional() }));
    });
    const { schema } = composeEnvSchema({
      features: [smtp],
      optionalFeatures: ["channel-email-smtp"],
    });
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ SMTP_HOST: "mail.example" }).success).toBe(true);
  });

  it("ignores features without envSchema", () => {
    const noEnv = defineFeature("no-env", () => {
      // declares nothing
    });
    const { schema, sources } = composeEnvSchema({ features: [noEnv] });
    expect(Object.keys(schema.shape)).toEqual([]);
    expect(sources).toEqual({});
  });
});

describe("r.envSchema()", () => {
  it("hangs the schema off the FeatureDefinition", () => {
    const feature = defineFeature("foo", (r) => {
      r.envSchema(z.object({ FOO_BAR: z.string() }));
    });
    expect(feature.envSchema).toBeDefined();
    expect(Object.keys(feature.envSchema!.shape)).toEqual(["FOO_BAR"]);
  });

  it("throws when called twice", () => {
    expect(() =>
      defineFeature("foo", (r) => {
        r.envSchema(z.object({ A: z.string() }));
        r.envSchema(z.object({ B: z.string() }));
      }),
    ).toThrow(/envSchema\(\) called twice/);
  });
});

describe("parseEnv", () => {
  it("returns the typed value on success", () => {
    const schema = z.object({
      PORT: z.string().regex(/^\d+$/),
      JWT_SECRET: z.string().min(32),
    });
    const value = parseEnv(schema, {
      PORT: "3000",
      JWT_SECRET: "x".repeat(32),
    });
    expect(value.PORT).toBe("3000");
    expect(value.JWT_SECRET.length).toBe(32);
  });

  it("aggregates ALL errors, not first-fail", () => {
    const schema = z.object({
      DATABASE_URL: z.url(),
      JWT_SECRET: z.string().min(32),
      ADMIN_EMAIL: z.email(),
    });
    try {
      parseEnv(schema, {
        DATABASE_URL: "not-a-url",
        // JWT_SECRET missing
        ADMIN_EMAIL: "not-an-email",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KumikoBootError);
      const boot = err as KumikoBootError;
      expect(boot.errors.length).toBe(3);
      const names = boot.errors.map((e) => e.name).sort();
      expect(names).toEqual(["ADMIN_EMAIL", "DATABASE_URL", "JWT_SECRET"]);
      const jwt = boot.errors.find((e) => e.name === "JWT_SECRET");
      expect(jwt?.kind).toBe("missing");
    }
  });

  it("strips undefined values so missing vars get a 'missing' kind", () => {
    const schema = z.object({ FOO: z.string() });
    try {
      parseEnv(schema, { FOO: undefined });
      throw new Error("should have thrown");
    } catch (err) {
      const boot = err as KumikoBootError;
      expect(boot.errors[0]!.kind).toBe("missing");
    }
  });

  it("attaches pulumi suggestions when prefix is set", () => {
    const schema = z.object({
      JWT_SECRET: z
        .string()
        .min(32)
        .meta({ kumiko: { pulumi: { generator: "openssl rand -base64 48", secret: true } } }),
    });
    try {
      parseEnv(schema, {}, { pulumiPrefix: "studio" });
    } catch (err) {
      const boot = err as KumikoBootError;
      expect(boot.errors[0]!.suggestion).toBe(
        'Set via: pulumi config set --secret studioJwtSecret "$(openssl rand -base64 48)"',
      );
    }
  });

  it("formats aggregate output with all errors", () => {
    const schema = z.object({
      A: z.string(),
      B: z.string().min(10).describe("Long-ish key"),
    });
    try {
      parseEnv(schema, { B: "short" });
    } catch (err) {
      const formatted = (err as KumikoBootError).format();
      expect(formatted).toContain("Boot failed: 2 env-var problems");
      expect(formatted).toContain("✗ A (required, missing)");
      expect(formatted).toContain("✗ B (invalid)");
      expect(formatted).toContain("Long-ish key");
    }
  });

  it("populates EnvError.source from options.sources, surfaced in format()", () => {
    const schema = z.object({ JWT_SECRET: z.string().min(32) });
    try {
      parseEnv(schema, {}, { sources: { JWT_SECRET: "auth-email-password" } });
    } catch (err) {
      const boot = err as KumikoBootError;
      expect(boot.errors[0]!.source).toBe("auth-email-password");
      expect(boot.format()).toContain("✗ JWT_SECRET (auth-email-password, required, missing)");
    }
  });
});

describe("pulumiConfigKey + camelCase", () => {
  it("camelCases SCREAMING_SNAKE_CASE", () => {
    expect(camelCase("JWT_SECRET")).toBe("jwtSecret");
    expect(camelCase("STUDIO_ADMIN_EMAIL")).toBe("studioAdminEmail");
    expect(camelCase("KUMIKO_SECRETS_MASTER_KEY_V1")).toBe("kumikoSecretsMasterKeyV1");
  });

  it("applies a prefix with PascalCase'd tail", () => {
    expect(pulumiConfigKey("JWT_SECRET", undefined, "studio")).toBe("studioJwtSecret");
  });

  it("uses meta.pulumi.name override when set", () => {
    const f = z.string().meta({ kumiko: { pulumi: { name: "secretsMasterKey" } } });
    expect(pulumiConfigKey("KUMIKO_SECRETS_MASTER_KEY_V1", f, "studio")).toBe(
      "studioSecretsMasterKey",
    );
  });

  it("returns the camelCase name when no prefix", () => {
    expect(pulumiConfigKey("JWT_SECRET", undefined, undefined)).toBe("jwtSecret");
  });
});
