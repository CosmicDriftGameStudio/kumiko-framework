// A schema field marked `kms` is decrypted once at boot and the RESOLVED env
// feeds the master-key probe: a ciphertext-only KUMIKO_SECRETS_MASTER_KEY_V1
// boots, and without any key the probe still fails. Boot-mode runs without
// Postgres/Redis (see run-prod-app-env-source.test.ts).

import { afterEach, describe, expect, test } from "bun:test";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { ComposedEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { z } from "zod";
import { runProdApp } from "../run-prod-app";
import { withClearedBootEnv } from "./boot-probe-fixture";

const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

const encryptedFeature = defineFeature("kms-slots-probe", (r) => {
  r.entity(
    "note",
    createEntity({
      table: "kms_slots_probe_note",
      fields: {
        body: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
      },
    }),
  );
});

const envSchema: ComposedEnvSchema = {
  schema: z.object({
    KUMIKO_SECRETS_MASTER_KEY_V1: z.string().meta({ kumiko: { kms: true } }),
  }),
  sources: {},
};

const BASE_ENV = {
  KUMIKO_DRY_RUN_ENV: "boot",
  DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "smokesmokesmokesmokesmokesmokesmokesmoke",
} as const;

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalInfo = console.info;

function bootWith(env: Record<string, string>): ReturnType<typeof runProdApp> {
  return runProdApp({
    features: [encryptedFeature],
    envSchema,
    autoListen: false,
    migrations: false,
    envSource: { ...BASE_ENV, ...env },
  });
}

describe("runProdApp kms slots", () => {
  withClearedBootEnv();
  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.info = originalInfo;
  });

  test("boots with a master key that exists only as Key Manager ciphertext", async () => {
    const decrypted: string[] = [];
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      decrypted.push(JSON.parse(String(init?.body)).ciphertext);
      return new Response(JSON.stringify({ plaintext: MASTER_KEY }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    console.log = () => {};
    console.info = () => {};

    const handle = await bootWith({
      KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT: "Y2lwaGVy",
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: "token",
    });

    await handle.stop();
    expect(decrypted).toEqual(["Y2lwaGVy"]);
  });

  test("a plaintext master key boots without any Key Manager request", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      throw new Error("must not be called");
    }) as unknown as typeof globalThis.fetch;
    console.log = () => {};
    console.info = () => {};

    const handle = await bootWith({
      KUMIKO_SECRETS_MASTER_KEY_V1: MASTER_KEY,
      KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT: "Y2lwaGVy",
    });

    await handle.stop();
    expect(requests).toBe(0);
  });

  test("without plaintext or ciphertext the boot probe still rejects", async () => {
    console.log = () => {};
    console.info = () => {};

    await expect(bootWith({ KUMIKO_SECRETS_MASTER_KEY_V1: "" })).rejects.toThrow(
      /no usable master key/,
    );
  });
});
