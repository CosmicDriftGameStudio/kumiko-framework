// Single-tenant shop wiring: defaultTenantId is the simplest setup. No
// resolver, no header, no cookie — anonymous requests just work. Suitable
// for WordPress-clones, SaaS landing pages, and standalone shops.
//
// For multi-tenant deployments, swap defaultTenantId for a tenantResolver
// that parses the host (acme.shop.com → tenantId) plus a tenantExists
// callback that confirms the tenant is real (against DB or cache).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { ANONYMOUS_USER_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  anonymousAccessFeature,
  guestOrderEntity,
  guestOrderTable,
  productEntity,
  productTable,
} from "../feature";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [anonymousAccessFeature],
    // The single-tenant shortcut: every anonymous request lands on this
    // tenant. No header, cookie, or resolver needed.
    anonymousAccess: { defaultTenantId: TENANT_ID },
  });
  await unsafeCreateEntityTable(stack.db, productEntity);
  await unsafeCreateEntityTable(stack.db, guestOrderEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack?.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${productTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${guestOrderTable.tableName}"`);
});

describe("public read: anonymous + authenticated share the listing", () => {
  test("anonymous caller sees products without any auth headers", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      { name: "Espresso Beans", priceCents: "1500" },
      TestUsers.admin,
    );

    const res = await stack.http.raw("POST", "/api/query", {
      type: "shop:query:product:list",
      payload: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe("Espresso Beans");
  });

  test("authenticated user reaches the same handler via JWT", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      { name: "Espresso Beans", priceCents: "1500" },
      TestUsers.admin,
    );

    const res = await stack.http.query("shop:query:product:list", {}, TestUsers.user);
    expect(res.status).toBe(200);
  });
});

describe("guest checkout: anonymous write lands with placedBy=anonymous", () => {
  test("anonymous order is stored and tagged with the anonymous user-id", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      { name: "Espresso Beans", priceCents: "1500" },
      TestUsers.admin,
    );

    const res = await stack.http.raw("POST", "/api/write", {
      type: "shop:write:guest-order:place",
      payload: {
        productId: "00000000-0000-4000-8000-000000000099",
        email: "guest@example.com",
      },
    });

    expect(res.status).toBe(200);

    const orders = await selectMany(stack.db, guestOrderTable);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.placedBy).toBe(ANONYMOUS_USER_ID);
    expect(orders[0]?.email).toBe("guest@example.com");
  });
});

describe("regression guards", () => {
  test("openToAll handler rejects anonymous (was the silent-public bug)", async () => {
    // The advisor-flagged regression risk: enabling anonymousAccess must NOT
    // turn every existing openToAll endpoint public. hasAccess explicitly
    // rejects anonymous on openToAll, so the dispatcher returns 403.
    const res = await stack.http.raw("POST", "/api/query", {
      type: "shop:query:product:authenticated-only",
      payload: {},
    });
    expect(res.status).toBe(403);
  });

  test("admin-only handler rejects anonymous", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "shop:write:product:create",
      payload: { name: "Tea Set", priceCents: "1000" },
    });
    expect(res.status).toBe(403);
  });
});
