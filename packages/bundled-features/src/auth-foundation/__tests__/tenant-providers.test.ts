// resolveTenantResolver / resolveTenantExistence + optional multiplicity (#1373).

import { describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  validateTenantExistenceMultiplicity,
  validateTenantResolverMultiplicity,
} from "../boot-checks.ts";
import {
  createAuthFoundationFeature,
  resolveTenantExistence,
  resolveTenantResolver,
} from "../feature.ts";
import { resolveAnonymousAccessFromRegistry } from "../resolve-anonymous-access.ts";
import {
  EXT_TENANT_EXISTENCE,
  EXT_TENANT_RESOLVER,
  type TenantExistenceProvider,
  type TenantResolverProvider,
} from "../types.ts";

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
    const registry = createRegistry([createAuthFoundationFeature()]);
    expect(await resolveTenantResolver({ db: fakeDb, registry })).toBeNull();
  });

  test("one provider → resolve + trust", async () => {
    const registry = createRegistry([createAuthFoundationFeature(), resolverProvider("subdomain")]);
    const resolved = await resolveTenantResolver({ db: fakeDb, registry });
    expect(resolved?.trust).toBe("authoritative");
    expect(await resolved?.resolve({})).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("resolveTenantExistence — optional single provider", () => {
  test("no provider → null", async () => {
    const registry = createRegistry([createAuthFoundationFeature()]);
    expect(await resolveTenantExistence({ db: fakeDb, registry })).toBeNull();
  });

  test("one provider → existence fn", async () => {
    const registry = createRegistry([createAuthFoundationFeature(), existenceProvider("db")]);
    const exists = await resolveTenantExistence({ db: fakeDb, registry });
    expect(await exists?.("00000000-0000-4000-8000-000000000001")).toBe(true);
  });
});

describe("validateTenantResolverMultiplicity", () => {
  test("0 providers → no throw", () => {
    const registry = createRegistry([createAuthFoundationFeature()]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).not.toThrow();
  });

  test("1 provider → no throw", () => {
    const registry = createRegistry([createAuthFoundationFeature(), resolverProvider("a")]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).not.toThrow();
  });

  test("≥2 providers → throws", () => {
    const registry = createRegistry([
      createAuthFoundationFeature(),
      resolverProvider("a"),
      resolverProvider("b"),
    ]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).toThrow(
      /2 tenantResolver providers/,
    );
  });

  test("malformed (no trust) → throws", () => {
    const broken = defineFeature("mock-broken-resolver", (r) => {
      // @ts-expect-error malformed plugin (no trust) — proves the runtime guard rejects it too.
      r.useExtension(EXT_TENANT_RESOLVER, "broken", { build: () => () => null });
    });
    const registry = createRegistry([createAuthFoundationFeature(), broken]);
    expect(() => validateTenantResolverMultiplicity([...registry.features.values()])).toThrow(
      /without a valid TenantResolverProvider/,
    );
  });
});

describe("validateTenantExistenceMultiplicity", () => {
  test("0 providers → no throw", () => {
    const registry = createRegistry([createAuthFoundationFeature()]);
    expect(() =>
      validateTenantExistenceMultiplicity([...registry.features.values()]),
    ).not.toThrow();
  });

  test("≥2 providers → throws", () => {
    const registry = createRegistry([
      createAuthFoundationFeature(),
      existenceProvider("a"),
      existenceProvider("b"),
    ]);
    expect(() => validateTenantExistenceMultiplicity([...registry.features.values()])).toThrow(
      /2 tenantExistence providers/,
    );
  });
});

describe("resolveAnonymousAccessFromRegistry — fail-closed trust", () => {
  test("inline tenantResolver without resolverTrust throws", async () => {
    const registry = createRegistry([createAuthFoundationFeature()]);
    await expect(
      resolveAnonymousAccessFromRegistry(
        {
          tenantResolver: () => "00000000-0000-4000-8000-000000000001" as TenantId,
        },
        { db: fakeDb, registry },
      ),
    ).rejects.toThrow(/resolverTrust/);
  });
});

describe("resolveAnonymousAccessFromRegistry — opt-in only (#1452)", () => {
  test("a mounted tenantResolver provider alone does not make anonymousAccess defined", async () => {
    const registry = createRegistry([createAuthFoundationFeature(), resolverProvider("subdomain")]);
    const result = await resolveAnonymousAccessFromRegistry(undefined, { db: fakeDb, registry });
    expect(result).toBeUndefined();
  });

  test("a mounted tenantExists provider alone does not make anonymousAccess defined", async () => {
    const registry = createRegistry([createAuthFoundationFeature(), existenceProvider("db")]);
    const result = await resolveAnonymousAccessFromRegistry(undefined, { db: fakeDb, registry });
    expect(result).toBeUndefined();
  });

  test("an app that explicitly opts in still gets providers merged", async () => {
    const registry = createRegistry([createAuthFoundationFeature(), resolverProvider("subdomain")]);
    const result = await resolveAnonymousAccessFromRegistry(
      { defaultTenantId: undefined },
      { db: fakeDb, registry },
    );
    expect(result?.tenantResolver).toBeDefined();
    expect(result?.resolverTrust).toBe("authoritative");
  });
});

describe("resolveAnonymousAccessFromRegistry — missing anonymousAccess warning", () => {
  test("warns when a feature with anonymous routes is mounted and anonymousAccess is unset", async () => {
    const registry = createRegistry([
      createAuthFoundationFeature(),
      defineFeature("host-routing", () => {}),
    ]);
    const warnings: string[] = [];
    const result = await resolveAnonymousAccessFromRegistry(undefined, {
      db: fakeDb,
      registry,
      warn: (message) => warnings.push(message),
    });
    expect(result).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("host-routing");
    expect(warnings[0]).toContain("anonymousAccess: {}");
  });

  test("stays quiet without such a feature or with anonymousAccess set", async () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    await resolveAnonymousAccessFromRegistry(undefined, {
      db: fakeDb,
      registry: createRegistry([createAuthFoundationFeature()]),
      warn,
    });
    await resolveAnonymousAccessFromRegistry(
      {},
      {
        db: fakeDb,
        registry: createRegistry([defineFeature("legal-pages", () => {})]),
        warn,
      },
    );
    expect(warnings).toEqual([]);
  });
});
