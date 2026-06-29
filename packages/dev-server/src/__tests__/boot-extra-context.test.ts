import { describe, expect, test } from "bun:test";
import { createSecretsFeature } from "@cosmicdrift/kumiko-bundled-features/secrets";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { MasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { buildBootExtraContext } from "../run-prod-app";

// Pins runProdApp's framework-default-provider autowire (buildBootExtraContext):
// textContent unconditional, secrets feature-gated, KEK-env trap avoided, and
// the money-horse regression (no secrets feature → no forced KEK → no throw).

// db is never touched at construction time — createTextContentApi /
// createSecretsContext only store the handle and query lazily. A bare stub
// keeps this a fast unit test (no Postgres) instead of a full boot.
const fakeDb = {} as unknown as DbConnection;
const registry = createRegistry([]);
const KEK = Buffer.alloc(32, 7).toString("base64");

const otherFeature = defineFeature("widgets", () => {});

describe("buildBootExtraContext — framework-default provider autowire", () => {
  test("textContent is wired unconditionally (no secrets feature, no auth)", () => {
    const ctx = buildBootExtraContext({
      db: fakeDb,
      features: [otherFeature],
      envSource: {},
      registry,
      hasAuth: false,
    });
    expect(typeof (ctx["textContent"] as { getBlock?: unknown }).getBlock).toBe("function");
    expect(ctx["secrets"]).toBeUndefined();
    expect(ctx["configResolver"]).toBeUndefined();
  });

  test("secrets feature mounted + valid KEK env → ctx.secrets wired", () => {
    const ctx = buildBootExtraContext({
      db: fakeDb,
      features: [createSecretsFeature()],
      envSource: { KUMIKO_SECRETS_MASTER_KEY_V1: KEK, KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1" },
      registry,
      hasAuth: false,
    });
    const secrets = ctx["secrets"] as { get?: unknown; set?: unknown; has?: unknown; delete?: unknown };
    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.set).toBe("function");
  });

  test("secrets feature mounted, only V1 set (no CURRENT_VERSION) → no throw (default '1')", () => {
    expect(() =>
      buildBootExtraContext({
        db: fakeDb,
        features: [createSecretsFeature()],
        envSource: { KUMIKO_SECRETS_MASTER_KEY_V1: KEK },
        registry,
        hasAuth: false,
      }),
    ).not.toThrow();
  });

  test("secrets feature mounted but NO KEK env → clear boot error (fail-fast)", () => {
    expect(() =>
      buildBootExtraContext({
        db: fakeDb,
        features: [createSecretsFeature()],
        envSource: {},
        registry,
        hasAuth: false,
      }),
    ).toThrow(/KEK|KUMIKO_SECRETS_MASTER_KEY/);
  });

  test("no secrets feature → no KEK ever read, boots green (money-horse regression)", () => {
    const ctx = buildBootExtraContext({
      db: fakeDb,
      features: [otherFeature],
      envSource: {}, // no KEK — must NOT matter when secrets isn't mounted
      registry,
      hasAuth: false,
    });
    expect(ctx["secrets"]).toBeUndefined();
  });

  test("masterKey override is used verbatim — no env-provider built", () => {
    const override: MasterKeyProvider = {
      wrapDek: async () => ({ encryptedDek: Buffer.alloc(0), kekVersion: 1 }),
      unwrapDek: async () => Buffer.alloc(0),
      currentVersion: () => 1,
      isAvailable: async () => true,
    };
    // envSource is empty: if the override weren't honoured, createEnvMasterKeyProvider
    // would throw "no KEK". It doesn't → the override path is taken.
    const ctx = buildBootExtraContext({
      db: fakeDb,
      features: [createSecretsFeature()],
      envSource: {},
      registry,
      hasAuth: false,
      masterKey: override,
    });
    expect(ctx["secrets"]).toBeDefined();
  });
});
