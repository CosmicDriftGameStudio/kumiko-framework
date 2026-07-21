import { describe, expect, test } from "bun:test";
import {
  authFoundationFeature,
  resolveAnonymousAccessFromRegistry,
  resolveTenantExistence,
  resolveTenantResolver,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createSubdomainTenantRoutingFeature } from "../feature";

const TENANT = "00000000-0000-4000-8000-0000000000aa" as TenantId;
const fakeDb = {} as DbConnection;

describe("auth-foundation-providers recipe", () => {
  test("useExtension registers resolver + existence; boot merge fills anonymousAccess", async () => {
    const routing = createSubdomainTenantRoutingFeature({
      lookupBySubdomain: async (sub) => (sub === "acme" ? TENANT : null),
      existsById: async (id) => id === TENANT,
      trust: "authoritative",
    });
    const registry = createRegistry([authFoundationFeature, routing]);

    const resolved = await resolveTenantResolver({ db: fakeDb, registry });
    expect(resolved?.trust).toBe("authoritative");
    expect(
      await resolved?.resolve({
        req: { header: (n: string) => (n === "Host" ? "acme.shop.com" : undefined) },
      }),
    ).toBe(TENANT);

    const exists = await resolveTenantExistence({ db: fakeDb, registry });
    expect(await exists?.(TENANT)).toBe(true);

    const anon = await resolveAnonymousAccessFromRegistry({}, { db: fakeDb, registry });
    expect(anon?.resolverTrust).toBe("authoritative");
    expect(anon?.tenantResolver).toBeDefined();
    expect(anon?.tenantExists).toBeDefined();
  });
});
