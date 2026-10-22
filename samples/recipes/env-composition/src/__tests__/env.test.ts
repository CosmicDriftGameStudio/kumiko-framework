import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { KumikoBootError, parseEnv } from "@cosmicdrift/kumiko-framework/env";
import { composeAppEnv } from "../env";

const masterKey = randomBytes(32).toString("base64");

const minimalValidValues = {
  DATABASE_URL: "postgres://app@localhost/app",
  REDIS_URL: "redis://localhost:6379",
  KUMIKO_SECRETS_MASTER_KEY_V1: masterKey,
  DEMO_ADMIN_EMAIL: "admin@example.com",
  DEMO_SYSADMIN_EMAIL: "root@example.com",
  APP_PUBLIC_URL: "https://app.example.com",
};

describe("env composition", () => {
  test("collects every block with the feature that declared it", () => {
    const { sources } = composeAppEnv();

    expect(sources["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe("secrets");
    expect(sources["PLATFORM_KEK"]).toBe("crypto-shredding");
    expect(sources["S3_BUCKET"]).toBe("file-provider-s3-env");
    expect(sources["RELEASES_S3_BUCKET"]).toBe("app");
    expect(sources["STRIPE_PRICE_PRO"]).toBe("app");
    expect(sources["DODO_PRODUCT_PRO"]).toBe("app");
  });

  test("parses into a typed env", () => {
    const composed = composeAppEnv();
    const parsed = parseEnv(composed.schema, {
      ...minimalValidValues,
      S3_BUCKET: "uploads",
      STRIPE_PRICE_PRO: "price_pro",
      DODO_PRODUCT_PRO: "pdt_pro",
    });

    const bucket: string | undefined = parsed.S3_BUCKET;
    const publicUrl: string = parsed.APP_PUBLIC_URL;
    expect(bucket).toBe("uploads");
    expect(publicUrl).toBe("https://app.example.com");
    expect(parsed.KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION).toBe("1");
    expect(parsed.DODO_PRODUCT_PRO).toBe("pdt_pro");
  });

  test("reports every missing required variable with its source", () => {
    const composed = composeAppEnv();
    let report = "";
    try {
      parseEnv(composed.schema, {}, { sources: composed.sources });
    } catch (err) {
      if (!(err instanceof KumikoBootError)) throw err;
      report = err.format();
    }

    expect(report).toContain("DATABASE_URL (framework-core, required, missing)");
    expect(report).toContain("KUMIKO_SECRETS_MASTER_KEY_V1 (secrets, required, missing)");
    expect(report).toContain("DEMO_ADMIN_EMAIL (app, required, missing)");
    expect(report).toContain("APP_PUBLIC_URL (app, required, missing)");
    expect(report).not.toContain("S3_BUCKET");
  });

  test("rejects a remote http S3 endpoint in production", () => {
    const composed = composeAppEnv();
    const originalNodeEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      expect(() =>
        parseEnv(composed.schema, { ...minimalValidValues, S3_ENDPOINT: "http://s3.example.com" }),
      ).toThrow(KumikoBootError);
    } finally {
      if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalNodeEnv;
    }
  });
});
