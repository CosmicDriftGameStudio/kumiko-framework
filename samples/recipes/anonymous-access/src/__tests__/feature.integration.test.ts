// Single-tenant shop wiring: defaultTenantId is the simplest setup. No
// resolver, no header, no cookie — anonymous requests just work. Suitable
// for WordPress-clones, SaaS landing pages, and standalone shops.
//
// For multi-tenant deployments, swap defaultTenantId for a tenantResolver
// that parses the host (acme.shop.com → tenantId) plus a tenantExists
// callback that confirms the tenant is real (against DB or cache).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { ANONYMOUS_USER_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  anonymousAccessFeature,
  guestOrderEntity,
  guestOrderTable,
  productEntity,
} from "../feature";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;

// Unique per test: the tenant is fixed, so rows are told apart by value, not by reset.
const PRODUCT_NAME = "Espresso Beans (anonymous read)";
const GUEST_EMAIL = "guest-checkout@example.com";

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

describe("public read: anonymous + authenticated share the listing", () => {
  test("anonymous caller sees products without any auth headers", async () => {
    await stack.http.writeOk(
      "shop:write:product:create",
      { name: PRODUCT_NAME, priceCents: "1500" },
      TestUsers.admin,
    );

    const res = await stack.http.raw("POST", "/api/query", {
      type: "shop:query:product:list",
      payload: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    const mine = body.data.filter((product) => product.name === PRODUCT_NAME);
    expect(mine).toHaveLength(1);
  });

  test("authenticated user reaches the same handler via JWT", async () => {
    const res = await stack.http.query("shop:query:product:list", {}, TestUsers.user);
    expect(res.status).toBe(200);
  });
});

describe("guest checkout: anonymous write lands with placedBy=anonymous", () => {
  test("anonymous order is stored and tagged with the anonymous user-id", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "shop:write:guest-order:place",
      payload: {
        productId: "00000000-0000-4000-8000-000000000099",
        email: GUEST_EMAIL,
      },
    });

    expect(res.status).toBe(200);

    const orders = (await selectMany(stack.db, guestOrderTable)).filter(
      (order) => order.email === GUEST_EMAIL,
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]?.placedBy).toBe(ANONYMOUS_USER_ID);
    expect(orders[0]?.email).toBe(GUEST_EMAIL);
  });
});

describe("regression guards", () => {
  test("openToAll handler rejects anonymous (was the silent-public bug)", async () => {
    // Enabling anonymousAccess must NOT turn every existing openToAll endpoint
    // public. hasAccess rejects anonymous on openToAll, and the dispatcher
    // answers 401: the caller has to sign in, not ask for another role.
    const res = await stack.http.raw("POST", "/api/query", {
      type: "shop:query:product:authenticated-only",
      payload: {},
    });
    expect(res.status).toBe(401);
  });

  test("admin-only handler rejects anonymous", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "shop:write:product:create",
      payload: { name: "Tea Set", priceCents: "1000" },
    });
    expect(res.status).toBe(401);
  });
});
