// Multi-tenant anonymous access: resolver + tenantExists + cookie
// persistence working together. The test shop has two real tenants
// (acme + globex) and one bogus subdomain to prove the 404 path.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setTenantCookie } from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { multiTenantShopFeature, productEntity, productTable } from "../feature";
import { createSubdomainResolver, extractSubdomain } from "../subdomain-resolver";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";

const ACME_TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const GLOBEX_TENANT_ID = "00000000-0000-4000-8000-000000000002" as TenantId;

// App-supplied lookup. In a real deployment this hits the tenants table;
// the in-memory map keeps the recipe focused on the resolution chain.
const KNOWN_TENANTS: Record<string, TenantId> = {
  acme: ACME_TENANT_ID,
  globex: GLOBEX_TENANT_ID,
};

let stack: TestStack;
let resolver: ReturnType<typeof createSubdomainResolver>;
// Counters prove that the cache actually hits — one DB lookup per
// subdomain in a tight loop is the difference between a working shop
// under load and one that buckles.
let lookupCount = 0;
let existsCount = 0;

beforeAll(async () => {
  resolver = createSubdomainResolver({
    lookupBySubdomain: async (sub) => {
      lookupCount++;
      return KNOWN_TENANTS[sub] ?? null;
    },
    existsById: async (id) => {
      existsCount++;
      return id === ACME_TENANT_ID || id === GLOBEX_TENANT_ID;
    },
    cacheTtlSeconds: 60,
  });

  stack = await setupTestStack({
    features: [multiTenantShopFeature],
    anonymousAccess: {
      tenantResolver: resolver.tenantResolver,
      tenantExists: resolver.tenantExists,
    },
  });
  await unsafeCreateEntityTable(stack.db, productEntity);
  await createEventsTable(stack.db);

  // Stamp test routes that exercise setTenantCookie. The framework gives
  // apps the helper; the route is app-territory.
  stack.app.get("/api/_set-tenant-cookie", (c) => {
    const tenantId = c.req.query("tenantId") as TenantId | undefined;
    if (!tenantId) return c.json({ error: "missing tenantId" }, 400);
    setTenantCookie(c, tenantId);
    return c.json({ ok: true });
  });
});

afterAll(async () => {
  await stack?.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${productTable.tableName}"`);
  resolver.invalidateAll();
  lookupCount = 0;
  existsCount = 0;
});

describe("subdomain resolution", () => {
  test("acme.shop.com → acme tenant", async () => {
    // Seed a product into acme — it should be visible to anonymous
    // visitors who land on acme.shop.com.
    await stack.http.writeOk(
      "mtshop:write:product:create",
      { name: "Acme Anvil" },
      { ...TestUsers.admin, tenantId: ACME_TENANT_ID },
    );

    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "mtshop:query:product:list", payload: {} },
      { Host: "acme.shop.com" },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data.map((p) => p.name)).toEqual(["Acme Anvil"]);
  });

  test("unknown subdomain → 400 tenant_required (resolver returned null)", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "mtshop:query:product:list", payload: {} },
      { Host: "bogus.shop.com" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_required");
  });

  test("reserved subdomain (www) → 400 tenant_required", async () => {
    // www.shop.com is the marketing landing — it must NOT silently fall
    // onto whatever tenant happens to be first in the DB.
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "mtshop:query:product:list", payload: {} },
      { Host: "www.shop.com" },
    );
    expect(res.status).toBe(400);
  });

  test("apex host without subdomain → 400 tenant_required", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "mtshop:query:product:list", payload: {} },
      { Host: "shop.com" },
    );
    expect(res.status).toBe(400);
  });
});

describe("cache behaviour", () => {
  test("repeated requests to the same subdomain hit the cache (1 DB lookup)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await stack.http.raw(
        "POST",
        "/api/query",
        { type: "mtshop:query:product:list", payload: {} },
        { Host: "acme.shop.com" },
      );
      expect(res.status).toBe(200);
    }
    expect(lookupCount).toBe(1);
  });

  test("invalidate() drops the cache entry → next request hits DB", async () => {
    // Warm the cache.
    await stack.http.raw(
      "POST",
      "/api/query",
      { type: "mtshop:query:product:list", payload: {} },
      { Host: "acme.shop.com" },
    );
    expect(lookupCount).toBe(1);

    // Simulate a tenant-disable flow: invalidate the cache entry, the
    // next request must consult the DB again.
    resolver.invalidate("acme");
    await stack.http.raw(
      "POST",
      "/api/query",
      { type: "mtshop:query:product:list", payload: {} },
      { Host: "acme.shop.com" },
    );
    expect(lookupCount).toBe(2);
  });
});

describe("cookie persistence", () => {
  test("X-Tenant header for known tenant routes through tenantExists", async () => {
    // Header-supplied tenants don't go through tenantResolver — they go
    // through tenantExists. This proves the second cache works.
    for (let i = 0; i < 3; i++) {
      const res = await stack.http.raw(
        "POST",
        "/api/query",
        { type: "mtshop:query:product:list", payload: {} },
        { Host: "anything.shop.com", "X-Tenant": ACME_TENANT_ID },
      );
      expect(res.status).toBe(200);
    }
    // tenantResolver was NOT called (header took precedence); tenantExists
    // was called once and then served from cache.
    expect(lookupCount).toBe(0);
    expect(existsCount).toBe(1);
  });

  test("X-Tenant for unknown id → 404 tenant_not_found", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "mtshop:query:product:list", payload: {} },
      {
        Host: "anything.shop.com",
        "X-Tenant": "00000000-0000-4000-8000-deadbeefdead",
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_not_found");
  });
});

describe("extractSubdomain (unit)", () => {
  test("typical SaaS host", () => {
    expect(extractSubdomain("acme.shop.com")).toBe("acme");
  });
  test("strips port", () => {
    expect(extractSubdomain("acme.shop.com:443")).toBe("acme");
  });
  test("apex returns null", () => {
    expect(extractSubdomain("shop.com")).toBeNull();
  });
  test("localhost returns null", () => {
    expect(extractSubdomain("localhost")).toBeNull();
  });
});
