// resolveTenantResolver / resolveTenantExistence + optional multiplicity (#1373).

import { describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  validateTenantExistenceMultiplicity,
  validateTenantResolverMultiplicity,
} from "../boot-checks";
import {
  authFoundationFeature,
  resolveTenantExistence,
  resolveTenantResolver,
} from "../feature";
import {
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  type TenantExistenceProvider,
  type TenantResolverProvider,
} from "../types";

const fakeDb = {} as DbConnection;

function resolverProvider(
  entityName: string,
  trust: "authoritative" | "fallback-only" = "authoritative",
): ReturnType<typeof defineFeature> {
  const plugin: TenantResolverProvider = {
    trust,
    build: () => async () => "00000000-0000-4000-8000-000000000001",
  };
  return defineFeature(`mock-resolver-${entityName}`, (r) => {
    r.useExtension(EXT_TENANT_RESOLVER, entityName, plugin);
  });
}

function existenceProvider(entityName: string): ReturnType<typeof defineFeature> {
  const plugin: TenantExistenceProvider = {
    build: () => async () => true,
  };
  return defineFeature(`mock-existence-${entityName}`, (r) => {
    r.useExtension(EXT_TENANT_EXISTENCE, entityName, plugin);
  });
}

describe("resolveTenantResolver — optional single provider", () => {
  test("no provider → null", async () => {
    const registry = createRegistry([authFoundationFeature]);
    expect(await resolveTenantResolver({ db: fakeDb, registry })).toBeNull();
  });

  test("one provider → resolve + trust", async () => {
    const registry = createRegistry([authFoundationFeature, resolverProvider("subdomain")]);
    const resolved = await resolveTenantResolver({ db: fakeDb, registry });
    expect(resolved?.trust).toBe("authoritative");
    expect(await resolved?.resolve({})).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("resolveTenantExistence — optional single provider", () => {
  test("no provider → null", async () => {
    const registry = createRegistry([authFoundationFeature]);
    expect(await resolveTenantExistence({ db: fakeDb, registry })).toBeNull();
  });

  test("one provider → existence fn", async () => {
    const registry = createRegistry([authFoundationFeature, existenceProvider("db")]);
    const exists = await resolveTenantExistence({ db: fakeDb, registry });
    expect(await exists?.("00000000-0000-4000-8000-000000000001")).toBe(true);
  });
});

describe("validateTenantResolverMultiplicity", () => {
  test("0 providers → no throw", () => {
    const registry = createRegistry([authFoundationFeature]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).not.toThrow();
  });

  test("1 provider → no throw", () => {
    const registry = createRegistry([authFoundationFeature, resolverProvider("a")]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).not.toThrow();
  });

  test("≥2 providers → throws", () => {
    const registry = createRegistry([
      authFoundationFeature,
      resolverProvider("a"),
      resolverProvider("b"),
    ]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).toThrow(
      /2 tenantResolver providers/,
    );
  });

  test("malformed (no trust) → throws", () => {
    const broken = defineFeature("mock-broken-resolver", (r) => {
      r.useExtension(EXT_TENANT_RESOLVER, "broken", { build: () => () => null });
    });
    const registry = createRegistry([authFoundationFeature, broken]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).toThrow(
      /without a valid TenantResolverProvider/,
    );
  });
});

describe("validateTenantExistenceMultiplicity", () => {
  test("0 providers → no throw", () => {
    const registry = createRegistry([authFoundationFeature]);
    expect(() =>
      validateTenantExistenceMultiplicity([...registry.features.values()]),
    ).not.toThrow();
  });

  test("≥2 providers → throws", () => {
    const registry = createRegistry([
      authFoundationFeature,
      existenceProvider("a"),
      existenceProvider("b"),
    ]);
    expect(() => validateTenantExistenceMultiplicity([...registry.features.values()])).toThrow(
      /2 tenantExistence providers/,
    );
  });
});
