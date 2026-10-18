import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createAuthFoundationFeature,
  resolveAnonymousAccessFromRegistry,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenant } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import { createUserFeature, userEntity } from "@cosmicdrift/kumiko-bundled-features/user";
import { createAnonymousUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { hostDispatch, hostRoutingFeature, routingOptions, storefrontFeature } from "../feature";

const SHOPS = [
  { id: "00000000-0000-4000-8000-0000000000b1" as TenantId, key: "acme", name: "Acme" },
  { id: "00000000-0000-4000-8000-0000000000b2" as TenantId, key: "globex", name: "Globex" },
  { id: "00000000-0000-4000-8000-0000000000b3" as TenantId, key: "initech", name: "Initech" },
] as const;

let stack: TestStack;

const systemQuery = (type: string, payload: unknown, tenantId: TenantId) =>
  stack.dispatcher.query(type, payload, createAnonymousUser(tenantId));

function whoami(host: string, headers: Record<string, string> = {}) {
  return stack.http.raw(
    "POST",
    "/api/query",
    { type: "storefront:query:whoami", payload: {} },
    { Host: host, ...headers },
  );
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthFoundationFeature(),
      hostRoutingFeature,
      storefrontFeature,
    ],
    // The app opts into anonymous access; the routing feature supplies the
    // resolver and existence check through the registry, as in runProdApp.
    anonymousAccess: {},
    enrichAnonymousAccess: (base, deps) => resolveAnonymousAccessFromRegistry(base, deps),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  for (const shop of SHOPS) await seedTenant(stack.db, shop);
});

afterAll(async () => stack?.cleanup());

describe("host-routing recipe", () => {
  test("three shop hosts land on three tenants", async () => {
    for (const shop of SHOPS) {
      const res = await whoami(`${shop.key}.${routingOptions.baseDomain}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { tenantId: string } };
      expect(body.data.tenantId).toBe(shop.id);
    }
  });

  test("a forged X-Tenant header is rejected", async () => {
    const res = await whoami(`acme.${routingOptions.baseDomain}`, { "X-Tenant": SHOPS[1].id });
    expect(res.status).toBe(400);
  });

  test("the page dispatch serves the shop shell with its CSP, or the 404 page", async () => {
    expect(
      await hostDispatch({ host: "globex.shop.test", path: "/", search: "" }, { systemQuery }),
    ).toEqual({ kind: "html", file: "shop.html", csp: routingOptions.tenant.csp });
    expect(
      await hostDispatch({ host: "nope.shop.test", path: "/", search: "" }, { systemQuery }),
    ).toEqual({ kind: "not-found", file: "unknown-shop.html" });
  });

  test("the default-locale prefix redirects, the English prefix gets its own file", async () => {
    expect(
      await hostDispatch({ host: "shop.test", path: "/de/about", search: "?a=1" }, { systemQuery }),
    ).toEqual({ kind: "redirect", to: "/about?a=1", status: 301 });
    expect(
      await hostDispatch({ host: "shop.test", path: "/en/about", search: "" }, { systemQuery }),
    ).toEqual({ kind: "html", file: "en/index.html" });
  });
});
