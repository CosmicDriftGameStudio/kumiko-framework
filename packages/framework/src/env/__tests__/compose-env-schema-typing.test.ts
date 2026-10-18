import { describe, expect, it } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/define-feature.ts";
import type { FeatureDefinition } from "../../engine/types/feature.ts";
import { composeEnvSchema, featureWithEnvSchema, KumikoBootError, parseEnv } from "../index.ts";

type IsExactly<TActual, TExpected> = [TActual] extends [TExpected]
  ? [TExpected] extends [TActual]
    ? true
    : false
  : false;

function assertType<TCondition extends true>(_proof?: TCondition): void {}

const mailEnvSchema = z.object({
  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.string().regex(/^\d+$/).optional(),
});
const storageEnvSchema = z.object({ STORAGE_BUCKET: z.string().min(1) });

function createMailFeature() {
  return featureWithEnvSchema(
    defineFeature("mail", (r) => {
      r.envSchema(mailEnvSchema);
    }),
    mailEnvSchema,
  );
}

function createStorageFeature() {
  return featureWithEnvSchema(
    defineFeature("storage", (r) => {
      r.envSchema(storageEnvSchema);
    }),
    storageEnvSchema,
  );
}

const untypedFeature: FeatureDefinition = defineFeature("untyped", (r) => {
  r.envSchema(z.object({ UNTYPED_VAR: z.string().optional() }));
});

describe("composeEnvSchema typing", () => {
  it("types the merged schema from core, typed feature fragments and extend", () => {
    const composed = composeEnvSchema({
      core: z.object({ DATABASE_URL: z.string() }),
      features: [createMailFeature(), createStorageFeature(), untypedFeature],
      extend: z.object({ APP_NAME: z.string() }),
    });
    const parsed = parseEnv(composed.schema, {
      DATABASE_URL: "postgres://localhost/app",
      MAIL_HOST: "smtp.example.com",
      STORAGE_BUCKET: "uploads",
      APP_NAME: "demo",
    });

    assertType<
      IsExactly<
        typeof parsed,
        {
          DATABASE_URL: string;
          MAIL_HOST: string;
          MAIL_PORT?: string | undefined;
          STORAGE_BUCKET: string;
          APP_NAME: string;
        }
      >
    >();
    expect(parsed).toEqual({
      DATABASE_URL: "postgres://localhost/app",
      MAIL_HOST: "smtp.example.com",
      STORAGE_BUCKET: "uploads",
      APP_NAME: "demo",
    });
    expect(Object.keys(composed.schema.shape)).toContain("UNTYPED_VAR");
  });

  it("keeps a widened feature array compiling without inventing keys", () => {
    const features: readonly FeatureDefinition[] = [createMailFeature()];
    const composed = composeEnvSchema({ features, extend: z.object({ APP_NAME: z.string() }) });
    const parsed = parseEnv(composed.schema, { MAIL_HOST: "smtp.example.com", APP_NAME: "demo" });

    assertType<IsExactly<typeof parsed, { APP_NAME: string }>>();
    expect(parsed).toMatchObject({ APP_NAME: "demo" });
    expect(composed.schema.shape).toHaveProperty("MAIL_HOST");
  });

  it("types every feature field optional when optionalFeatures is set", () => {
    const composed = composeEnvSchema({
      features: [createMailFeature()],
      optionalFeatures: ["mail"],
    });
    const parsed = parseEnv(composed.schema, {});

    assertType<
      IsExactly<typeof parsed, { MAIL_HOST?: string | undefined; MAIL_PORT?: string | undefined }>
    >();
    expect(parsed).toEqual({});
  });

  it("rejects a feature typed with a schema it did not register", () => {
    const feature = defineFeature("mail", (r) => {
      r.envSchema(z.object({ MAIL_HOST: z.string() }));
    });
    expect(() => featureWithEnvSchema(feature, mailEnvSchema)).toThrow(
      /did not register this schema instance/,
    );
  });
});

describe("composeEnvSchema extend", () => {
  it("accepts a feature's own field instance spread into extend", () => {
    const composed = composeEnvSchema({
      features: [createMailFeature()],
      extend: z.object({ ...mailEnvSchema.shape, APP_NAME: z.string() }),
    });

    expect(composed.sources).toEqual({ MAIL_HOST: "mail", MAIL_PORT: "mail", APP_NAME: "app" });
  });

  it("still rejects a different field under a feature's key", () => {
    expect(() =>
      composeEnvSchema({
        features: [createMailFeature()],
        extend: z.object({ MAIL_HOST: z.string() }),
      }),
    ).toThrow(KumikoBootError);
  });
});
