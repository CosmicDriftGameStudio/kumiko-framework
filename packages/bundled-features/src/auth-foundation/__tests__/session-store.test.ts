// resolveSessionStore + the sessionStore multiplicity boot-check (#1370).
// Mock providers registered via r.useExtension(EXT_SESSION_STORE, ...) in
// throwaway test-features — no real sessions provider exists yet.

import { describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { validateSessionStoreMultiplicity } from "../boot-checks";
import { authFoundationFeature, resolveSessionStore } from "../feature";
import { EXT_SESSION_STORE, type SessionStore, type SessionStoreProvider } from "../types";

const fakeDb = {} as DbConnection; // @cast-boundary test fixture, unused by mock providers

function mockStore(): SessionStore {
  return {
    creator: async () => "sid-1",
    revoker: async () => undefined,
    checker: async () => "live",
    massRevoker: async () => 0,
    revokeAllOthers: async () => 0,
  };
}

function storeProvider(entityName = "mock-store"): ReturnType<typeof defineFeature> {
  const plugin: SessionStoreProvider = { build: () => mockStore() };
  return defineFeature(`mock-${entityName}`, (r) => {
    r.useExtension(EXT_SESSION_STORE, entityName, plugin);
  });
}

describe("resolveSessionStore — finds the single registered provider", () => {
  test("returns the built SessionStore", async () => {
    const registry = createRegistry([authFoundationFeature, storeProvider()]);
    const store = await resolveSessionStore({ db: fakeDb, registry });
    expect(await store.checker("sid-1", "u1")).toBe("live");
  });

  test("no provider registered → throws", async () => {
    const registry = createRegistry([authFoundationFeature]);
    await expect(resolveSessionStore({ db: fakeDb, registry })).rejects.toThrow(
      /no sessionStore provider registered/,
    );
  });
});

describe("validateSessionStoreMultiplicity", () => {
  test("0 providers registered → throws (fail-fast, nothing to store sessions in)", () => {
    const registry = createRegistry([authFoundationFeature]);
    expect(() => validateSessionStoreMultiplicity([...registry.features.values()])).toThrow(
      /no sessionStore provider registered/,
    );
  });

  test("exactly 1 provider → no throw", () => {
    const registry = createRegistry([authFoundationFeature, storeProvider()]);
    expect(() => validateSessionStoreMultiplicity([...registry.features.values()])).not.toThrow();
  });

  test("≥2 providers → throws a conflict error", () => {
    const registry = createRegistry([
      authFoundationFeature,
      storeProvider("store-a"),
      storeProvider("store-b"),
    ]);
    expect(() => validateSessionStoreMultiplicity([...registry.features.values()])).toThrow(
      /2 sessionStore providers registered/,
    );
  });

  test("malformed registration (no build) → throws a malformed-plugin error", () => {
    const broken = defineFeature("mock-broken", (r) => {
      r.useExtension(EXT_SESSION_STORE, "broken", {});
    });
    const registry = createRegistry([authFoundationFeature, broken]);
    expect(() => validateSessionStoreMultiplicity([...registry.features.values()])).toThrow(
      /without a valid SessionStoreProvider/,
    );
  });
});

