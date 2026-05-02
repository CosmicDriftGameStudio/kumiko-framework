// Full-stack proof for anonymousAccess: handlers that allow roles=["anonymous"]
// must be reachable WITHOUT a JWT, while the rest of /api/* still requires
// authentication. Covers the resolution chain (defaultTenantId, X-Tenant
// header, kumiko_tenant cookie, custom resolver) plus the rejection paths
// (no tenant, unknown tenant, openToAll-protected).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../db/event-store-executor";
import { buildDrizzleTable } from "../db/table-builder";
import {
  ANONYMOUS_USER_ID,
  createEntity,
  createTextField,
  defineFeature,
  type TenantId,
} from "../engine";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../stack";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const OTHER_TENANT_ID = "00000000-0000-4000-8000-000000000002" as TenantId;

// --- Feature ---

const productEntity = createEntity({
  table: "anon_products",
  fields: {
    name: createTextField({ required: true }),
  },
});
const productTable = buildDrizzleTable("product", productEntity);

const orderEntity = createEntity({
  table: "anon_orders",
  fields: {
    productName: createTextField({ required: true }),
    placedBy: createTextField({ default: "" }),
  },
});
const orderTable = buildDrizzleTable("order", orderEntity);

const shopFeature = defineFeature("anonshop", (r) => {
  r.entity("product", productEntity);
  r.entity("order", orderEntity);

  // Public listing — anonymous + authenticated customers see it.
  r.queryHandler(
    "product:list",
    z.object({}),
    async (_event, ctx) => {
      const rows = await ctx.db.select().from(productTable);
      return rows;
    },
    { access: { roles: ["anonymous", "User", "Admin"] } },
  );

  // Authenticated-only listing — confirms openToAll still rejects anonymous.
  r.queryHandler(
    "product:list-auth-only",
    z.object({}),
    async (_event, ctx) => {
      const rows = await ctx.db.select().from(productTable);
      return rows;
    },
    { access: { openToAll: true } },
  );

  // Anonymous can place a guest order.
  r.writeHandler(
    "order:guest-checkout",
    z.object({ productName: z.string().min(1) }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(orderTable, orderEntity, { entityName: "order" });
      return crud.create(
        { productName: event.payload.productName, placedBy: event.user.id },
        event.user,
        ctx.db,
      );
    },
    { access: { roles: ["anonymous", "User"] } },
  );

  // Admin-only — confirms role-gated handlers still reject anonymous.
  r.writeHandler(
    "product:create",
    z.object({ name: z.string().min(1) }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(productTable, productEntity, {
        entityName: "product",
      });
      return crud.create({ name: event.payload.name }, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );
});

// --- Suite ---

describe("anonymous access — single-tenant default", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [shopFeature],
      anonymousAccess: { defaultTenantId: TENANT_ID },
    });
    await createEntityTable(stack.db, productEntity);
    await createEntityTable(stack.db, orderEntity);
  });

  afterAll(() => stack.cleanup());

  beforeEach(async () => {
    await stack.db.delete(productTable);
    await stack.db.delete(orderTable);
  });

  test("anonymous query succeeds without any auth headers", async () => {
    // Seed a product with the admin user so the query has data to return.
    await stack.http.writeOk(
      "anonshop:write:product:create",
      { name: "Espresso Beans" },
      TestUsers.admin,
    );

    const res = await stack.http.raw("POST", "/api/query", {
      type: "anonshop:query:product:list",
      payload: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe("Espresso Beans");
  });

  test("anonymous write succeeds and records actor=anonymous", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "anonshop:write:order:guest-checkout",
      payload: { productName: "Espresso Beans" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean };
    expect(body.isSuccess).toBe(true);

    // Verify the row landed with placedBy=anonymous in the DB. Confirms the
    // synthesised SessionUser actually flows through to the handler.
    const rows = await stack.db.select().from(orderTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["placedBy"]).toBe(ANONYMOUS_USER_ID);
  });

  test("openToAll handler rejects anonymous (regression guard)", async () => {
    // The advisor-flagged regression: enabling anonymousAccess must NOT
    // silently expose every existing openToAll endpoint. hasAccess refuses
    // anonymous on openToAll, so the dispatcher returns AccessDenied.
    const res = await stack.http.raw("POST", "/api/query", {
      type: "anonshop:query:product:list-auth-only",
      payload: {},
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("access_denied");
  });

  test("role-gated handler still rejects anonymous", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: "anonshop:write:product:create",
      payload: { name: "Tea Set" },
    });
    expect(res.status).toBe(403);
  });

  test("authenticated user with JWT bypasses anonymous path entirely", async () => {
    const res = await stack.http.query("anonshop:query:product:list", {}, TestUsers.admin);
    expect(res.status).toBe(200);
  });

  test("X-Tenant header that disagrees with default → 400 tenant_mismatch", async () => {
    // Single-tenant mode is locked: a client cannot override defaultTenantId
    // by sending a different X-Tenant. Silent acceptance would let a
    // confused client write into the wrong tenant of a single-tenant
    // deployment that happened to have data for OTHER_TENANT_ID.
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "anonshop:query:product:list", payload: {} },
      { "X-Tenant": OTHER_TENANT_ID },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_mismatch");
  });

  test("X-Tenant header matching default → accepted", async () => {
    // Same default, redundant header — fine.
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "anonshop:query:product:list", payload: {} },
      { "X-Tenant": TENANT_ID },
    );
    expect(res.status).toBe(200);
  });
});

describe("anonymous access — header-supplied tenant", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [shopFeature],
      anonymousAccess: {
        // No defaultTenantId — every anonymous request must declare its tenant.
        tenantExists: async (id: TenantId) => id === TENANT_ID || id === OTHER_TENANT_ID,
      },
    });
    await createEntityTable(stack.db, productEntity);
    await createEntityTable(stack.db, orderEntity);
  });

  afterAll(() => stack.cleanup());

  test("X-Tenant header resolves the tenant", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "anonshop:query:product:list", payload: {} },
      { "X-Tenant": TENANT_ID },
    );
    expect(res.status).toBe(200);
  });

  test("malformed X-Tenant header → 400 invalid_tenant_format", async () => {
    // Junk strings (SQL fragments, path traversals, plain typos) must never
    // reach the pipeline as a TenantId. parseTenantId rejects anything that
    // isn't a UUID-shape, the middleware turns that into a 400 here.
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "anonshop:query:product:list", payload: {} },
      { "X-Tenant": "not-a-uuid" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details: { source: string } };
    };
    expect(body.error.code).toBe("invalid_tenant_format");
    expect(body.error.details.source).toBe("X-Tenant header");
  });

  test("missing tenant → 400 tenant_required", async () => {
    const res = await stack.http.raw("POST", "/api/query", {
      type: "anonshop:query:product:list",
      payload: {},
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; i18nKey: string } };
    expect(body.error.code).toBe("tenant_required");
    expect(body.error.i18nKey).toBe("auth.errors.tenantRequired");
  });

  test("/api/auth/* without JWT → 401 missing_token (not 400 tenant_required)", async () => {
    // Auth-routes (tenants, switch-tenant, logout) brauchen einen JWT,
    // aber keinen Tenant-Resolve. Vor dem Fix fielen sie in handleAnonymous,
    // das beim resolveTenant ohne X-Tenant 400 tenant_required wirft —
    // falsche Diagnose, der Caller ist unauthenticated, nicht ohne Tenant.
    // Login bleibt davon unberührt (in PUBLIC_API_PATHS, skipped vor auth).
    const res = await stack.http.raw("GET", "/api/auth/tenants");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; i18nKey: string } };
    expect(body.error.code).toBe("missing_token");
    expect(body.error.i18nKey).toBe("auth.errors.missingToken");
  });

  test("authenticated request with conflicting X-Tenant header → 400 tenant_mismatch", async () => {
    // JWT carries tenantId=TENANT_ID, but the client sends X-Tenant for a
    // different tenant. Silent ignore would let the client think it's
    // hitting OTHER_TENANT_ID while it's actually on TENANT_ID — defensive
    // reject, same shape as ambiguous_auth.
    const token = await stack.jwt.sign(TestUsers.admin);
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "anonshop:query:product:list", payload: {} },
      { Authorization: `Bearer ${token}`, "X-Tenant": OTHER_TENANT_ID },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_mismatch");
  });

  test("unknown tenant → 404 tenant_not_found", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "anonshop:query:product:list", payload: {} },
      { "X-Tenant": "00000000-0000-4000-8000-deadbeefdead" },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_not_found");
  });
});

describe("anonymous access — disabled by default", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [shopFeature] });
    await createEntityTable(stack.db, productEntity);
    await createEntityTable(stack.db, orderEntity);
  });

  afterAll(() => stack.cleanup());

  test("missing JWT → 401 (no anonymous fall-through)", async () => {
    const res = await stack.http.raw("POST", "/api/query", {
      type: "anonshop:query:product:list",
      payload: {},
    });
    expect(res.status).toBe(401);
  });
});
